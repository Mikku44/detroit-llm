import threading

import tiktoken

_encoding_lock = threading.Lock()
_encoding = None


def _get_encoding():
    global _encoding
    if _encoding is None:
        with _encoding_lock:
            if _encoding is None:
                _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


def count_text_tokens(text: str) -> int:
    if not text:
        return 0
    return len(_get_encoding().encode(text))


def count_messages_tokens(messages: list) -> int:
    """Approximate prompt token count of an OpenAI-style messages list (cl100k_base)."""
    enc = _get_encoding()
    total = 0
    for msg in messages:
        total += 4  # message framing
        role = msg.get("role", "")
        if role:
            total += len(enc.encode(role))
        content = msg.get("content")
        if isinstance(content, str):
            total += len(enc.encode(content))
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text" and part.get("text"):
                    total += len(enc.encode(part["text"]))
                elif part.get("type") == "image_url":
                    total += 85  # image token allowance
        else:
            total += 0
    total += 2  # reply priming
    return total


def count_responses_input_tokens(input_data) -> int:
    """Approximate prompt token count of a Responses API `input` (string or item list)."""
    enc = _get_encoding()
    if isinstance(input_data, str):
        return len(enc.encode(input_data)) if input_data else 0
    total = 0
    for item in input_data if isinstance(input_data, list) else []:
        if isinstance(item, str):
            total += len(enc.encode(item))
        elif isinstance(item, dict):
            item_type = item.get("type", "")
            if item_type in ("function_call", "function_call_output"):
                total += 4
            elif item_type == "message":
                total += 4
            content = item.get("content")
            if isinstance(content, str):
                total += len(enc.encode(content))
            elif isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") == "output_text" and part.get("text"):
                        total += len(enc.encode(part["text"]))
                    elif part.get("type") == "text" and part.get("text"):
                        total += len(enc.encode(part["text"]))
                    elif part.get("type") == "image_url":
                        total += 85  # image token allowance
    return total
