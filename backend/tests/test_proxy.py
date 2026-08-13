from backend.proxy.router import _parse_usage_from_chunk


def test_parse_usage_from_chunk():
    chunk = b'data: {"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}}'
    usage = _parse_usage_from_chunk(chunk)
    assert usage["prompt_tokens"] == 5
    assert usage["completion_tokens"] == 3
    assert usage["total_tokens"] == 8


def test_parse_usage_done_chunk():
    assert _parse_usage_from_chunk(b"data: [DONE]") is None


def test_parse_usage_non_sse_chunk():
    assert _parse_usage_from_chunk(b"random bytes") is None


def test_parse_usage_chunk_without_usage():
    chunk = b'data: {"choices": [{"delta": {"content": "hi"}}]}'
    assert _parse_usage_from_chunk(chunk) is None


def test_mock_chat_completions_stream(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    body = r.text
    assert "data: [DONE]" in body
    assert "chatcmpl-mock" in body


def test_usage_recorded_after_non_stream_chat(client, session_token, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200

    usage = client.get(
        "/admin/usage?days=7", headers={"Authorization": f"Bearer {session_token}"}
    ).json()["usage"]
    assert len(usage) == 7
    active = [row for row in usage if row["requests"] > 0]
    assert len(active) == 1
    assert active[0]["requests"] == 1
    assert active[0]["prompt_tokens"] == 15
    assert active[0]["completion_tokens"] > 0


def test_usage_recorded_after_stream_chat(client, session_token, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200
    _ = r.text  # consume full stream so the generator finishes and logs usage

    usage = client.get(
        "/admin/usage?days=7", headers={"Authorization": f"Bearer {session_token}"}
    ).json()["usage"]
    assert len(usage) == 7
    active = [row for row in usage if row["requests"] > 0]
    assert len(active) == 1
    assert active[0]["requests"] == 1
    assert active[0]["completion_tokens"] > 0
