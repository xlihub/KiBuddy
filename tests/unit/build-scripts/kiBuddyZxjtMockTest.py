"""Exercise the standalone mock through real HTTP, without customer access."""

import http.client
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "distributions/mock"))
from kiBuddyZxjtServer import MockServer  # noqa: E402


AUTH = {"appId": "mock-app-id", "secretKey": "mock-secret-key", "apikey": "mock-api-key"}
BODY = {"model": "qwen3.8-27b-zxjt", "stream": False, "messages": [{"role": "user", "content": "Reply with exactly ZXJT_PROBE_OK."}]}
WEATHER = {"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.output = tempfile.TemporaryDirectory(prefix="zxjt mock 中文 ")
        self.options = SimpleNamespace(host="127.0.0.1", port=0, scenario="field", case="baseline-stream", time_scale=0,
                                       first_byte_ms=0, chunk_ms=0, stall_ms=500, record=str(Path(self.output.name) / "requests.jsonl"))
        self.server = MockServer(self.options)
        # Tests never inherit local credentials chosen for a developer's running server.
        self.server.credentials = AUTH.copy()
        self.recorded = threading.Event()
        original_record = self.server.record

        def record_and_signal(record):
            original_record(record)
            self.recorded.set()

        self.server.record = record_and_signal
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.stopping.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.output.cleanup()

    def open(self, body=None, auth=None, path="/inner/ai/llm/chat", timeout=3):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=timeout)
        client.request("POST", path, json.dumps(BODY if body is None else body).encode(),
                       {"Content-Type": "application/json", **(AUTH if auth is None else auth)})
        return client, client.getresponse()

    def post(self, **kwargs):
        client, response = self.open(**kwargs)
        try:
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def test_auth_matrix_matches_field_failures_and_optional_bearer(self):
        for headers, status, marker in [
            ({}, 202, "10005"), ({"Authorization": "Bearer mock-api-key"}, 202, "10005"),
            ({k: v for k, v in AUTH.items() if k != "apikey"}, 202, "10005"),
            ({k: v for k, v in AUTH.items() if k != "appId"}, 200, "data:001|身份验证失败"),
            ({k: v for k, v in AUTH.items() if k != "secretKey"}, 200, "data:001|身份验证失败"),
            ({**AUTH, "Authorization": "Bearer mock-api-key"}, 200, "ZXJT_PROBE_OK"),
        ]:
            with self.subTest(headers=list(headers)):
                actual, _, wire = self.post(auth=headers)
                self.assertEqual(actual, status)
                self.assertIn(marker, wire.decode())

    def test_wrong_secret_is_a_documented_synthetic_auth_failure(self):
        client, response = self.open(auth={**AUTH, "secretKey": "wrong"})
        try:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("X-Zxjt-Mock"), "synthetic-auth")
            self.assertTrue(response.read().startswith("data:001|身份验证失败".encode()))
        finally:
            client.close()
        self.assertTrue(self.recorded.wait(timeout=2), "request was not recorded")
        self.assertEqual(self.server.records[-1]["behavior"], "synthetic-auth")
        self.assertEqual(self.server.records[-1]["captureCase"], "auth-omit_secretKey")

    def test_none_disables_tools_and_conflicting_directive_is_rejected(self):
        request = {**BODY, "tools": [WEATHER], "tool_choice": "none"}
        _, _, wire = self.post(body=request)
        message = json.loads(wire)["choices"][0]["message"]
        self.assertNotIn("tool_calls", message)
        self.assertEqual(message["content"], "ZXJT_PROBE_OK")
        request["messages"] = [{"role": "user", "content": 'ZXJT_MOCK_TOOL {"name":"get_weather","arguments":{}}'}]
        self.assertEqual(self.post(body=request)[0], 400)

    def test_invalid_role_and_tool_choice_types_return_controlled_errors(self):
        for role in ([], {}, None, 123):
            with self.subTest(role=role):
                self.assertEqual(self.post(body={**BODY, "messages": [{"role": role, "content": "test"}]})[0], 400)
        for choice in ([], None, 123, "unsupported"):
            with self.subTest(choice=choice):
                self.assertEqual(self.post(body={**BODY, "tool_choice": choice})[0], 400)

    def test_model_error_is_sse_even_for_nonstreaming_request(self):
        status, content_type, wire = self.post(body={**BODY, "model": "unknown"})
        self.assertEqual(status, 200)
        self.assertTrue(content_type.startswith("text/event-stream"))
        self.assertEqual(wire.decode(), "data:模型名称错误，请确认后再重新调用\n\n")

    def test_named_choice_is_rejected_and_options_do_not_remove_usage(self):
        _, _, wire = self.post(body={**BODY, "tool_choice": {"type": "function", "function": {"name": "get_weather"}}})
        self.assertEqual(wire, b"data:Bad Request\n\n")
        for options in ({}, {"stream_options": {"include_usage": True}, "parallel_tool_calls": True, "reasoning_effort": "low"}):
            _, _, wire = self.post(body={**BODY, **options, "stream": True})
            self.assertIn(b'"choices":[],"usage":', wire)
            self.assertTrue(wire.endswith(b"data:[DONE]\n\n"))

    def test_tool_roundtrip_uses_actual_returned_value_and_new_turn_is_independent(self):
        request = {**BODY, "tools": [WEATHER]}
        _, _, first = self.post(body=request)
        call = json.loads(first)["choices"][0]["message"]["tool_calls"][0]
        self.assertEqual(json.loads(call["function"]["arguments"]), {"city": "Beijing"})
        request["messages"] = BODY["messages"] + [
            {"role": "assistant", "tool_calls": [call]},
            {"role": "tool", "tool_call_id": call["id"], "content": '{"probe_marker":"independent-marker-619"}'},
        ]
        _, _, second = self.post(body=request)
        answer = json.loads(second)["choices"][0]["message"]["content"]
        self.assertEqual(answer, "independent-marker-619\n</think>\n\nindependent-marker-619")
        request["messages"].append({"role": "user", "content": "new turn"})
        _, _, third = self.post(body=request)
        self.assertIn("tool_calls", json.loads(third)["choices"][0]["message"])

    def test_mismatched_and_duplicate_tool_result_ids_are_rejected(self):
        messages = BODY["messages"] + [{"role": "assistant", "tool_calls": [{"id": "call-1"}]}]
        for replies in ([{"role": "tool", "tool_call_id": "wrong", "content": "result"}],
                        [{"role": "tool", "tool_call_id": "call-1", "content": "result"}] * 2, []):
            self.assertEqual(self.post(body={**BODY, "messages": messages + replies})[0], 400)

    def test_explicit_real_tool_directive_only_calls_advertised_tool(self):
        tool = {"type": "function", "function": {"name": "Read", "parameters": {"type": "object"}}}
        prompt = 'ZXJT_MOCK_TOOL {"name":"Read","arguments":{"file_path":"/tmp/mock.txt"}}'
        request = {**BODY, "tools": [tool], "messages": [{"role": "user", "content": prompt}], "stream": True}
        _, _, wire = self.post(body=request)
        events = [json.loads(line[5:]) for line in wire.decode().splitlines() if line.startswith("data:{")]
        calls = [call for event in events for choice in event["choices"] for call in choice.get("delta", {}).get("tool_calls", [])]
        self.assertEqual(calls[0]["function"]["name"], "Read")
        self.assertEqual(json.loads("".join(c["function"].get("arguments", "") for c in calls)), {"file_path": "/tmp/mock.txt"})
        self.assertEqual(self.post(body={**request, "tools": []})[0], 400)

    def test_all_21_replay_cases_preserve_original_body_status_and_content_type(self):
        self.options.scenario = "replay"
        self.assertEqual(len(self.server.capture["cases"]), 21)
        for name, case in self.server.capture["cases"].items():
            self.options.case = name
            with self.subTest(case=name):
                status, content_type, wire = self.post()
                self.assertEqual((status, content_type, wire), (case["httpStatus"], case["contentType"], case["body"].encode()))

    def test_stream_arrives_before_completion_and_keeps_data_colon_without_space(self):
        self.options.chunk_ms = 60
        client, response = self.open(body={**BODY, "stream": True})
        try:
            started = time.monotonic()
            line = response.readline()
            self.assertTrue(line.startswith(b"data:{"))
            tail = response.read()
            self.assertGreater(time.monotonic() - started, 0.15)
            self.assertIn(b"data:[DONE]", tail)
        finally:
            client.close()

    def test_missing_done_and_ignored_stream_remain_distinct(self):
        self.options.scenario = "missing-done"
        _, _, wire = self.post(body={**BODY, "stream": True})
        self.assertNotIn(b"[DONE]", wire)
        self.assertIn(b'"finish_reason":"stop"', wire)
        self.options.scenario = "ignore-stream"
        _, content_type, wire = self.post(body={**BODY, "stream": True})
        self.assertEqual((content_type.startswith("application/json"), json.loads(wire)["choices"][0]["message"]["content"]), (True, "ZXJT_PROBE_OK"))

    def test_truncated_http_stream_is_detectably_incomplete(self):
        self.options.scenario = "truncated"
        client, response = self.open(body={**BODY, "stream": True})
        try:
            with self.assertRaises(http.client.IncompleteRead):
                response.read()
        finally:
            client.close()

    def test_header_and_idle_delays_can_trigger_real_client_timeouts(self):
        for scenario in ("headers-timeout", "idle-timeout"):
            self.options.scenario = scenario
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=0.08)
            try:
                client.request("POST", "/inner/ai/llm/chat", json.dumps({**BODY, "stream": True}), AUTH)
                with self.assertRaises(socket.timeout):
                    client.getresponse().read()
            finally:
                client.close()

    def test_invalid_multimodal_requests_and_guessed_paths_are_not_success(self):
        self.assertEqual(self.post(path="/v1/chat/completions")[0], 404)
        self.assertEqual(self.post(body={**BODY, "messages": [{"role": "user", "content": [{"type": "image_url"}]}]})[0], 400)
        self.assertEqual(self.post(body={**BODY, "messages": []})[0], 400)

    def test_journal_reports_request_options_without_credentials_or_content(self):
        private_text = "secret-business-prompt-953"
        self.post(body={**BODY, "messages": [{"role": "user", "content": private_text}], "stream_options": {"include_usage": True}})
        self.assertTrue(self.recorded.wait(timeout=2), "request journal was not committed")
        journal = Path(self.options.record).read_text()
        for secret in [*AUTH.values(), private_text]:
            self.assertNotIn(secret, journal)
        self.assertTrue(json.loads(journal)["optionPresence"]["stream_options"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
