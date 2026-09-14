"""Deterministic Chat Completions behavior based on the zxjt field capture."""

import copy
import json
import uuid


MODEL = "qwen3.8-27b-zxjt"
RESPONSE_MODEL = "qwen3.8-27b"
CHAT_PATH = "/inner/ai/llm/chat"
TOOL_DIRECTIVE = "ZXJT_MOCK_TOOL "


class MockRequestError(ValueError):
    """An unsupported synthetic request, not a captured gateway error."""


def validate_request(body):
    """Reject unsupported input instead of silently claiming it was tested."""
    if not isinstance(body, dict) or not isinstance(body.get("messages"), list):
        raise MockRequestError("messages must be an array")
    if not isinstance(body.get("model"), str) or not isinstance(body.get("stream", False), bool):
        raise MockRequestError("model must be a string and stream a boolean")
    if not body["messages"]:
        raise MockRequestError("messages must not be empty")
    for message in body["messages"]:
        if not isinstance(message, dict) or not isinstance(message.get("role"), str) or message["role"] not in {"system", "developer", "user", "assistant", "tool"}:
            raise MockRequestError("unsupported message role")
        content = message.get("content")
        if content is not None and not isinstance(content, str):
            # Text blocks are used by real SDK projectors; images remain unverified.
            if not isinstance(content, list) or not all(
                isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
                for part in content
            ):
                raise MockRequestError("mock supports text only; multimodal behavior is not verified")
    choice = body.get("tool_choice", "auto")
    if not isinstance(choice, str) or choice not in {"auto", "required", "none"}:
        raise MockRequestError("mock supports tool_choice auto, required or none")
    tools = body.get("tools", [])
    if not isinstance(tools, list):
        raise MockRequestError("tools must be an array")
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "function" or not isinstance(tool.get("function"), dict):
            raise MockRequestError("tools must use Chat Completions function definitions")
        if not isinstance(tool["function"].get("name"), str):
            raise MockRequestError("tool name must be a string")


def message_text(message):
    content = message.get("content") or ""
    if isinstance(content, list):
        return "\n".join(part["text"] for part in content)
    return content


def current_turn(body):
    messages = body["messages"]
    last_user = next((i for i in range(len(messages) - 1, -1, -1) if messages[i]["role"] == "user"), None)
    if last_user is None:
        raise MockRequestError("a user message is required")
    return message_text(messages[last_user]), messages[last_user + 1:]


def tool_result(messages):
    """Validate the current turn's call IDs before reflecting tool output."""
    pending = {}
    results = []
    for message in messages:
        if message["role"] == "assistant":
            calls = message.get("tool_calls", [])
            if not isinstance(calls, list):
                raise MockRequestError("assistant.tool_calls must be an array")
            for call in calls:
                if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not call["id"] or call["id"] in pending:
                    raise MockRequestError("tool calls need unique nonempty IDs")
                pending[call["id"]] = True
        elif message["role"] == "tool":
            call_id = message.get("tool_call_id")
            if not isinstance(call_id, str) or call_id not in pending or not pending[call_id]:
                raise MockRequestError("tool_call_id must match one unanswered assistant tool call")
            pending[call_id] = False
            text = message_text(message)
            try:
                parsed = json.loads(text)
                text = str(parsed["probe_marker"]) if isinstance(parsed, dict) and "probe_marker" in parsed else text
            except (ValueError, TypeError):
                pass
            results.append(text)
    if any(pending.values()):
        raise MockRequestError("all assistant tool calls need matching tool results")
    return "\n".join(results) if results else None


def select_answer(body):
    """Return a synthetic answer/call; never execute tools on the server."""
    prompt, turn = current_turn(body)
    result = tool_result(turn)
    if result is not None:
        # Retain the observed orphan closing tag for renderer regression checks.
        return "tool-reply", result + "\n</think>\n\n" + result, None
    tools = {tool["function"]["name"]: tool for tool in body.get("tools", [])}
    directive = next((line[len(TOOL_DIRECTIVE):] for line in prompt.splitlines() if line.startswith(TOOL_DIRECTIVE)), None)
    if body.get("tool_choice") == "none":
        if directive is not None:
            raise MockRequestError("ZXJT_MOCK_TOOL conflicts with tool_choice none")
        tools = {}
    if directive is not None:
        try:
            desired = json.loads(directive)
        except ValueError as error:
            raise MockRequestError("ZXJT_MOCK_TOOL requires a JSON object") from error
        if not isinstance(desired, dict) or not isinstance(desired.get("name"), str) or not isinstance(desired.get("arguments"), dict):
            raise MockRequestError("ZXJT_MOCK_TOOL needs name and arguments object")
        if desired["name"] not in tools:
            raise MockRequestError("requested tool was not advertised by the client")
        name, arguments = desired["name"], desired["arguments"]
    elif "get_weather" in tools:
        name, arguments = "get_weather", {"city": "Beijing"}
    else:
        if body.get("tool_choice") == "required":
            raise MockRequestError("use ZXJT_MOCK_TOOL to select a real advertised tool")
        if "ZXJT_PROBE_OK" in prompt:
            return "text", "ZXJT_PROBE_OK", None
        if body.get("max_tokens") == 16 or prompt.strip().lower() in {"ok", "reply with exactly ok."}:
            return "health", "OK", None
        return "text", "[ZXJT MOCK] " + prompt, None
    call = {"id": "call_mock_" + uuid.uuid4().hex[:16], "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))}}
    return "tool", "", call


def make_response(body, cases):
    """Build dynamic content in the captured JSON/SSE envelope shape."""
    kind, content, call = select_answer(body)
    stream = body.get("stream", False)
    source = "tool-json" if call else "baseline-json"
    response = copy.deepcopy(json.loads(cases[source]["body"]))
    response["id"] = "chatcmpl-mock-" + uuid.uuid4().hex
    response["model"] = RESPONSE_MODEL
    message = {"role": "assistant", "content": None if call else content, "reasoning": None}
    if call:
        message["tool_calls"] = [call]
    finish = "tool_calls" if call else "stop"
    response["choices"][0].update(message=message, finish_reason=finish)
    # Synthetic token counts are deliberately not presented as tokenizer results.
    response["usage"] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "prompt_tokens_details": None}
    if not stream:
        return kind, [json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()], "application/json; charset=utf-8"
    deltas = [{"role": "assistant"}]
    if call:
        fn = call["function"]
        deltas.append({"tool_calls": [{"index": 0, "id": call["id"], "type": "function", "function": {"name": fn["name"]}}]})
        deltas.extend({"tool_calls": [{"index": 0, "function": {"arguments": fn["arguments"][i:i + 7]}}]}
                      for i in range(0, len(fn["arguments"]), 7))
    else:
        deltas.extend({"content": content[i:i + 12]} for i in range(0, len(content), 12))
    common = {"id": response["id"], "object": "chat.completion.chunk", "created": response["created"], "model": RESPONSE_MODEL}
    events = [{**common, "choices": [{"index": 0, "delta": delta}]} for delta in deltas]
    events.append({**common, "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
    events.append({**common, "choices": [], "usage": response["usage"]})
    chunks = [("data:" + json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n\n").encode() for event in events]
    chunks.append(b"data:[DONE]\n\n")
    return kind, chunks, "text/event-stream; charset=utf-8"
