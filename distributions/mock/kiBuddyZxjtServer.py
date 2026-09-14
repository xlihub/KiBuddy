"""Local zxjt gateway simulator. Python 3.10+, standard library only."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import socket
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from kiBuddyZxjtProtocol import CHAT_PATH, MODEL, MockRequestError, make_response, validate_request


CAPTURE = Path(__file__).with_name("kiBuddyZxjtCapture.json")
SCENARIOS = ("field", "replay", "headers-timeout", "idle-timeout", "truncated", "missing-done", "ignore-stream", "http-429", "http-500")
MAX_BODY_BYTES = 1024 * 1024


def load_capture():
    """Verify each captured body and its byte offsets before serving it."""
    capture = json.loads(CAPTURE.read_text(encoding="utf-8"))
    for case in capture["cases"].values():
        body = case["body"].encode()
        if hashlib.sha256(body).hexdigest() != case["bodySha256"]:
            raise ValueError("captured body checksum mismatch")
        if not case["reads"] or case["reads"][-1]["EndOffset"] != len(body):
            raise ValueError("captured body timeline mismatch")
    return capture


class MockServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, options):
        self.options = options
        self.capture = load_capture()
        self.records = deque(maxlen=200)
        self.record_lock = threading.Lock()
        self.sequence = 0
        self.stopping = threading.Event()
        self.credentials = {
            "appId": os.environ.get("ZXJT_MOCK_APP_ID", "mock-app-id"),
            "secretKey": os.environ.get("ZXJT_MOCK_SECRET_KEY", "mock-secret-key"),
            "apikey": os.environ.get("ZXJT_MOCK_API_KEY", "mock-api-key"),
        }
        if any(not value or "\r" in value or "\n" in value for value in self.credentials.values()):
            raise ValueError("mock credentials must be nonempty single-line values")
        super().__init__((options.host, options.port), Handler)

    def record(self, record):
        with self.record_lock:
            self.records.append(record)
            line = json.dumps(record, ensure_ascii=False)
            if self.options.record:
                with open(self.options.record, "a", encoding="utf-8") as output:
                    output.write(line + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        # Default access logs expose URLs; the explicit journal contains metadata only.
        pass

    def reply(self, status, body, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        self.close_connection = True

    def do_GET(self):
        if self.path == "/__mock/health":
            value = {"mock": True, "scenario": self.server.options.scenario, "case": self.server.options.case,
                     "endpointPath": CHAT_PATH, "model": MODEL, "sourceZipSha256": self.server.capture["sourceZipSha256"]}
        elif self.path == "/__mock/requests":
            with self.server.record_lock:
                value = {"total": self.server.sequence, "requests": list(self.server.records)}
        else:
            # The field capture never supplied a models URL. Do not invent discovery.
            self.reply(404, b'{"mock":true,"error":"route not implemented"}')
            with self.server.record_lock:
                self.server.sequence += 1
                request_id = self.server.sequence
            self.server.record({"id": request_id, "method": "GET", "routeMatched": False, "httpStatus": 404})
            return
        self.reply(200, json.dumps(value, ensure_ascii=False).encode())

    def wait_until(self, started, milliseconds):
        deadline = started + milliseconds / 1000
        while time.monotonic() < deadline:
            if self.server.stopping.is_set():
                raise ConnectionAbortedError("mock stopping")
            readable, _, _ = select.select([self.connection], [], [], min(0.05, max(0, deadline - time.monotonic())))
            if readable and self.connection.recv(1, socket.MSG_PEEK) == b"":
                raise ConnectionAbortedError("client disconnected")

    def send_chunks(self, status, content_type, chunks, times, first_ms, record, truncate=False):
        started = time.monotonic()
        self.wait_until(started, first_ms)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Zxjt-Mock", record["behavior"])
        self.send_header("Connection", "close")
        is_sse = content_type.startswith("text/event-stream")
        if is_sse:
            self.send_header("Transfer-Encoding", "chunked")
        else:
            self.send_header("Content-Length", str(sum(map(len, chunks))))
        self.end_headers()
        self.wfile.flush()
        self.close_connection = True
        for chunk, at_ms in zip(chunks, times):
            self.wait_until(started, at_ms)
            if is_sse:
                self.wfile.write(f"{len(chunk):X}\r\n".encode() + chunk + b"\r\n")
            else:
                self.wfile.write(chunk)
            self.wfile.flush()
            record["bodyBytesSent"] += len(chunk)
        if is_sse and not truncate:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        record["completed"] = not truncate

    def captured(self, name, record, behavior="captured"):
        case = self.server.capture["cases"][name]
        body = case["body"].encode()
        scale = self.server.options.time_scale
        chunks, offset = [], 0
        for mark in case["reads"]:
            chunks.append(body[offset:mark["EndOffset"]])
            offset = mark["EndOffset"]
        record.update(behavior=behavior, captureCase=name, httpStatus=case["httpStatus"])
        self.send_chunks(case["httpStatus"], case["contentType"], chunks,
                         [mark["AtMs"] * scale for mark in case["reads"]], case["headersMs"] * scale, record)

    def dispatch(self, body, record):
        options = self.server.options
        if options.scenario == "replay":
            # Explicit replay is request-independent, useful for reproducing SDK failures.
            self.captured(options.case, record)
            return
        good = record["authMatches"]
        auth_behavior = "synthetic-auth" if any(record["authPresent"][key] and not matches for key, matches in good.items()) else "captured"
        if not good["apikey"]:
            self.captured("auth-omit_apikey", record, auth_behavior)
            return
        if not good["appId"] or not good["secretKey"]:
            self.captured("auth-omit_appId" if not good["appId"] else "auth-omit_secretKey", record, auth_behavior)
            return
        if body.get("model") != MODEL:
            self.captured("error-unknown-model", record)
            return
        if isinstance(body.get("tool_choice"), dict):
            self.captured("parameter-tool-choice-named", record)
            return
        validate_request(body)
        record["behavior"] = "synthetic-" + options.scenario
        if options.scenario in {"http-429", "http-500"}:
            status = int(options.scenario[-3:])
            record["httpStatus"] = status
            self.reply(status, json.dumps({"error": {"code": status, "message": "Synthetic mock failure"}}).encode())
            record["completed"] = True
            return
        if options.scenario == "ignore-stream":
            body = {**body, "stream": False}
        kind, chunks, content_type = make_response(body, self.server.capture["cases"])
        record.update(httpStatus=200, responseKind=kind)
        first = options.first_byte_ms
        times = [first + i * options.chunk_ms for i in range(len(chunks))]
        if options.scenario == "headers-timeout":
            first += options.stall_ms
            times = [t + options.stall_ms for t in times]
        elif options.scenario == "idle-timeout":
            times = [times[0]] + [t + options.stall_ms for t in times[1:]]
        elif options.scenario == "missing-done" and content_type.startswith("text/event-stream"):
            chunks, times = chunks[:-1], times[:-1]
        elif options.scenario == "truncated":
            chunks, times = chunks[:2], times[:2]
        self.send_chunks(200, content_type, chunks, times, first, record, truncate=options.scenario == "truncated")

    def do_POST(self):
        with self.server.record_lock:
            self.server.sequence += 1
            request_id = self.server.sequence
        record = {"id": request_id, "method": "POST", "routeMatched": self.path == CHAT_PATH,
                  "behavior": "synthetic-validation", "completed": False, "bodyBytesSent": 0,
                  "authMatches": {key: self.headers.get(key) == value for key, value in self.server.credentials.items()},
                  "authPresent": {key: key in self.headers for key in self.server.credentials},
                  "bearerPresent": "Authorization" in self.headers}
        started = time.monotonic()
        try:
            if self.path != CHAT_PATH:
                record["httpStatus"] = 404
                self.reply(404, b'{"mock":true,"error":"use the exact full chat URL"}')
                return
            length = self.headers.get("Content-Length")
            if self.headers.get("Transfer-Encoding") or length is None or not length.isdigit():
                raise MockRequestError("send JSON with Content-Length; chunked requests are not supported")
            if not 0 < int(length) <= MAX_BODY_BYTES:
                raise MockRequestError("request body must be between 1 byte and 1 MiB")
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise MockRequestError("incomplete request body")
            try:
                body = json.loads(raw)
            except (ValueError, UnicodeError) as error:
                raise MockRequestError("invalid JSON") from error
            if not isinstance(body, dict):
                raise MockRequestError("request must be an object")
            # Only allowlisted option metadata is recorded, never arbitrary input.
            record["modelMatches"] = body.get("model") == MODEL
            record["stream"] = body.get("stream") if isinstance(body.get("stream"), bool) else None
            record["optionPresence"] = {key: key in body for key in ("tools", "stream_options", "tool_choice", "parallel_tool_calls", "reasoning_effort", "max_tokens")}
            record["options"] = {}
            stream_options = body.get("stream_options")
            if isinstance(stream_options, dict) and isinstance(stream_options.get("include_usage"), bool):
                record["options"]["include_usage"] = stream_options["include_usage"]
            if isinstance(body.get("parallel_tool_calls"), bool):
                record["options"]["parallel_tool_calls"] = body["parallel_tool_calls"]
            if isinstance(body.get("max_tokens"), int) and not isinstance(body["max_tokens"], bool):
                record["options"]["max_tokens"] = body["max_tokens"]
            for key, choices in (("tool_choice", ("auto", "required", "none")), ("reasoning_effort", ("low", "medium", "high"))):
                if isinstance(body.get(key), str) and body[key] in choices:
                    record["options"][key] = body[key]
            self.dispatch(body, record)
        except MockRequestError as error:
            record["httpStatus"] = 400
            self.reply(400, json.dumps({"mock": True, "error": {"message": str(error)}}, ensure_ascii=False).encode())
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            record["disconnected"] = True
        finally:
            record["elapsedMs"] = round((time.monotonic() - started) * 1000)
            self.server.record(record)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18789)
    parser.add_argument("--scenario", choices=SCENARIOS, default="field")
    parser.add_argument("--case", choices=list(load_capture()["cases"]), default="baseline-stream")
    parser.add_argument("--time-scale", type=float, default=1, help="captured response timing multiplier")
    parser.add_argument("--first-byte-ms", type=int, default=250, help="synthetic response header delay")
    parser.add_argument("--chunk-ms", type=int, default=50, help="synthetic SSE event interval")
    parser.add_argument("--stall-ms", type=int, default=60000, help="synthetic timeout delay")
    parser.add_argument("--record", help="append metadata-only request journal as JSONL")
    parser.add_argument("--ready-file", help="write bound address and PID as JSON for local tooling")
    options = parser.parse_args()
    if not 0 <= options.port <= 65535 or not 0 <= options.time_scale <= 100 or any(
        not 0 <= value <= 600000 for value in (options.first_byte_ms, options.chunk_ms, options.stall_ms)
    ):
        parser.error("invalid port or timing range")
    return options


def main():
    options = arguments()
    server = MockServer(options)
    ready = {"host": options.host, "port": server.server_port, "pid": os.getpid(), "scenario": options.scenario,
             "url": f"http://{options.host}:{server.server_port}{CHAT_PATH}", "model": MODEL}
    if options.ready_file:
        Path(options.ready_file).write_text(json.dumps(ready) + "\n", encoding="utf-8")
    print(json.dumps(ready), flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.stopping.set()
        server.server_close()


if __name__ == "__main__":
    main()
