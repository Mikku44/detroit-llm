import asyncio
import json

import httpx
import pytest

from backend.proxy.router import (
    _parse_usage_from_chunk,
    _responses_text_from_chunk,
    _responses_usage_from_chunk,
    _responses_output_text,
    _text_from_chunk,
    _anthropic_to_chat_messages,
    _anthropic_tools_to_chat,
    _anthropic_chat_payload,
    _build_anthropic_message,
    _image_seed,
    _mock_image_b64,
    _mock_image_svg,
    _parse_image_toolcall,
    _wants_image,
    _parse_wants_image,
    _classify_image_intent,
    _detect_image_intent,
    _image_source,
    _loremflickr_url,
)
from backend.proxy.tokens import count_responses_input_tokens


def test_free_user_key_allowed_on_chat(client, verified_free_user_id):
    """Free-tier users may call the OpenAI-compatible API (mock response)."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"]


def test_free_user_key_allowed_on_responses(client, verified_free_user_id):
    """Free-tier users pass the access gate on /v1/responses; the missing
    DeepSeek key is the only thing left to reject (503)."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/responses",
        json={"model": "deepseek-v4-flash", "input": "hi"},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 503
    assert "no DeepSeek key" in r.text


def test_free_user_key_allowed_on_anthropic(client, verified_free_user_id):
    """Free-tier users may call the Anthropic-compatible endpoint (mock response)."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/messages",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text
    assert "content" in r.json()


@pytest.mark.asyncio
async def test_free_user_over_weekly_limit_rejected(client, verified_free_user_id, db_session):
    """Free-tier users are blocked once their weekly token budget runs out."""
    from backend.auth.session import create_session_token
    from backend.db.models import UsageLog

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()

    db_session.add_all(
        [
            UsageLog(api_key_id=created["id"], model="deepseek-v4-pro", prompt_tokens=60000, completion_tokens=0, total_tokens=60000),
            UsageLog(api_key_id=created["id"], model="deepseek-v4-pro", prompt_tokens=40000, completion_tokens=0, total_tokens=40000),
        ]
    )
    await db_session.commit()

    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "Weekly limit reached" in r.text


@pytest.mark.asyncio
async def test_free_user_over_monthly_limit_rejected(client, verified_free_user_id, db_session):
    """Free-tier users are blocked once the monthly budget runs out, even if
    the weekly window looks fine."""
    from datetime import datetime, timedelta, timezone
    from backend.auth.session import create_session_token
    from backend.db.models import UsageLog

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add_all(
        [
            UsageLog(api_key_id=created["id"], model="deepseek-v4-pro", prompt_tokens=50000, completion_tokens=0, total_tokens=50000),
            # 15 days ago: inside the 30-day window but outside the 7-day one.
            UsageLog(
                api_key_id=created["id"],
                model="deepseek-v4-pro",
                prompt_tokens=390000,
                completion_tokens=0,
                total_tokens=390000,
                created_at=now - timedelta(days=15),
            ),
        ]
    )
    await db_session.commit()

    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "Monthly limit reached" in r.text


@pytest.mark.asyncio
async def test_free_user_below_weekly_limit_allowed(client, verified_free_user_id, db_session):
    """Free-tier users under the weekly/monthly budgets keep working."""
    from backend.auth.session import create_session_token
    from backend.db.models import UsageLog

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()

    db_session.add(
        UsageLog(api_key_id=created["id"], model="deepseek-v4-pro", prompt_tokens=100, completion_tokens=50, total_tokens=150)
    )
    await db_session.commit()

    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text


def test_session_token_rejected_on_v1_chat(client, non_member_user_id):
    """Session tokens are for the web chat only and must NOT reach /v1/*."""
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 401


def test_non_member_session_allowed_web_chat(client, non_member_user_id):
    """Web chat (session token) is open to everyone, membership not required."""
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.post(
        "/api/web/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"]


def test_free_user_pro_model_rejected(client, verified_free_user_id):
    """Free-tier users are blocked from non-flash models."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"model": "deepseek-v4-pro", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "flash model" in r.text


def test_free_user_vision_model_rejected(client, verified_free_user_id):
    """deepseek-v4-flash-vision-exp is paid/member-only, not free."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "deepseek-v4-flash-vision-exp",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "vision" in r.json()["detail"].lower()


def test_member_can_use_vision_model(client, api_key):
    """Members/owners may use deepseek-v4-flash-vision-exp (no model gate block)."""
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "deepseek-v4-flash-vision-exp",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    # The model gate passes for members, so the request proceeds (mock reply
    # when no DeepSeek key is configured) instead of being 403'd.
    assert r.status_code == 200, r.text


def test_free_user_defaults_to_flash(client, verified_free_user_id):
    """Free-tier users without a model are silently routed to the flash model."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text


def test_verified_free_user_allowed(client, verified_free_user_id):
    """Verified free-tier users may use the API."""
    from backend.auth.session import create_session_token

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "free"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text


def test_member_ignores_verification(client, non_member_user_id):
    """Members get access even without phone verification."""
    from backend.auth.session import create_session_token
    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    import asyncio

    async def make_member():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            user.is_member = True
            await db.commit()

    asyncio.run(make_member())

    token = create_session_token(non_member_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "member"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"model": "deepseek-v4-pro", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text


def test_member_can_use_pro_model(client, api_key):
    """Member/owner users keep access to pro and other models."""
    r = client.post(
        "/v1/chat/completions",
        json={"model": "deepseek-v4-pro", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text


def test_qwen_requires_dashscope_key(client, api_key, monkeypatch):
    """Qwen models without a DashScope key fail with a clear 503."""
    from backend.config import settings

    monkeypatch.setattr(settings, "dashscope_api_key", "")
    r = client.post(
        "/v1/chat/completions",
        json={"model": "qwen3.7-flash", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "DASHSCOPE_API_KEY" in r.text


def test_qwen_routes_to_dashscope(client, api_key, monkeypatch):
    """A qwen model request is proxied to the DashScope endpoint."""
    from backend.config import settings

    monkeypatch.setattr(settings, "dashscope_api_key", "test-key")

    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [{"message": {"content": "qwen reply", "role": "assistant"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2},
            }

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    class FakeDB:
        async def execute(self, *a, **k):
            return FakeResult()

        async def commit(self):
            pass

        async def add(self, *a, **k):
            pass

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["body"] = json
            return FakeResponse()

    import backend.proxy.router as r
    from backend.proxy.router import _handle_chat_completions

    orig_http = r.httpx.AsyncClient
    r.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        resp = asyncio.run(
            _handle_chat_completions(
                FakeDB(),
                "u1",
                {"model": "qwen3.7-flash", "messages": [{"role": "user", "content": "hi"}], "stream": False},
            )
        )
    finally:
        r.httpx.AsyncClient = orig_http

    assert captured["url"].endswith("/compatible-mode/v1/chat/completions")
    assert captured["body"]["model"] == "qwen3.7-flash"
    assert resp.status_code == 200


def test_qwen_flash_is_free_tier_ok():
    """qwen3.7-flash counts as a flash model, so free-tier users may use it."""
    from backend.proxy.router import _is_flash_model

    assert _is_flash_model("qwen3.7-flash") is True
    assert _is_flash_model("qwen3.7-pro") is False


def test_openrouter_requires_key(client, api_key, monkeypatch):
    """stealth/ox-alpha without an OpenRouter key fails with a clear 503."""
    from backend.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "")
    r = client.post(
        "/v1/chat/completions",
        json={"model": "stealth/ox-alpha", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "OPENROUTER_API_KEY" in r.text


def test_openrouter_routes_to_openrouter(client, api_key, monkeypatch):
    """stealth/ox-alpha is proxied to the OpenRouter endpoint."""
    from backend.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")

    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [{"message": {"content": "openrouter reply", "role": "assistant"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2},
            }

    class FakeUser:
        id = "u1"
        is_member = True
        is_owner = False
        is_paid = False

    class FakeResult:
        def scalar_one_or_none(self):
            return FakeUser()

    class FakeDB:
        async def execute(self, *a, **k):
            return FakeResult()

        async def commit(self):
            pass

        async def add(self, *a, **k):
            pass

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["body"] = json
            captured["headers"] = headers
            return FakeResponse()

    import backend.proxy.router as r
    from backend.proxy.router import _handle_chat_completions

    orig_http = r.httpx.AsyncClient
    r.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        resp = asyncio.run(
            _handle_chat_completions(
                FakeDB(),
                "u1",
                {"model": "stealth/ox-alpha", "messages": [{"role": "user", "content": "hi"}], "stream": False},
            )
        )
    finally:
        r.httpx.AsyncClient = orig_http

    assert captured["url"].endswith("/chat/completions")
    assert "openrouter.ai" in captured["url"]
    assert captured["body"]["model"] == "stealth/ox-alpha"
    assert resp.status_code == 200


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


def test_text_from_chunk_includes_tool_calls():
    chunk = (
        b'data: {"choices": [{"delta": {"tool_calls": [{"function": '
        b'{"name": "get_weather", "arguments": "{\\"city\\": \\"Bangkok\\"}"}}]}}]}'
    )
    text = _text_from_chunk(chunk)
    assert "get_weather" in text
    assert "Bangkok" in text


def test_responses_usage_from_completed_chunk():
    chunk = (
        b'data: {"type": "response.completed", "response": {"usage": '
        b'{"input_tokens": 12, "output_tokens": 7, "total_tokens": 19}}}'
    )
    usage = _responses_usage_from_chunk(chunk)
    assert usage["input_tokens"] == 12
    assert usage["output_tokens"] == 7


def test_responses_usage_ignores_other_events():
    chunk = b'data: {"type": "response.created", "response": {}}'
    assert _responses_usage_from_chunk(chunk) is None
    assert _responses_usage_from_chunk(b"data: [DONE]") is None


def test_responses_text_from_delta():
    chunk = b'data: {"type": "response.output_text.delta", "delta": "hello"}'
    assert _responses_text_from_chunk(chunk) == "hello"


def test_responses_output_text_aggregates_items():
    data = {
        "output": [
            {"type": "function_call", "name": "get_weather", "arguments": '{"city":"Bangkok"}'},
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "It is sunny."}],
            },
        ]
    }
    text = _responses_output_text(data)
    assert "Bangkok" in text
    assert "sunny" in text


def test_count_responses_input_tokens_string():
    assert count_responses_input_tokens("hello world") > 0
    assert count_responses_input_tokens("") == 0


def test_responses_unavailable_without_deepseek_key(client, api_key):
    r = client.post(
        "/v1/responses",
        json={"model": "deepseek-v4-flash", "input": "hi"},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "no DeepSeek key" in r.text


def test_vision_requires_gemini_key(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What is in this image?"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                    ],
                }
            ]
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "Vision is not configured" in r.text


def test_qwen_vision_does_not_require_gemini(client, api_key, monkeypatch):
    """Qwen image requests must NOT switch to Gemini.

    Regression: an image request with a Qwen model previously fell into the
    Gemini branch and 503'd without a Gemini key. Qwen should go to DashScope.
    """
    from backend.config import settings

    # No Gemini key, so if the request were routed to Gemini it would 503.
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(settings, "dashscope_api_key", "test-key")

    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [{"message": {"content": "ok", "role": "assistant"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            }

    class FakeUser:
        id = "u1"
        is_member = True
        is_owner = False
        is_paid = False

    class FakeResult:
        def scalar_one_or_none(self):
            return FakeUser()

    class FakeDB:
        async def execute(self, *a, **k):
            return FakeResult()

        async def commit(self):
            pass

        async def add(self, *a, **k):
            pass

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            return FakeResponse()

    import backend.proxy.router as r
    from backend.proxy.router import _handle_chat_completions

    orig_http = r.httpx.AsyncClient
    r.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        resp = asyncio.run(
            _handle_chat_completions(
                FakeDB(),
                "u1",
                {
                    "model": "qwen3.7-flash",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "What is in this image?"},
                                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                            ],
                        }
                    ],
                    "stream": False,
                },
            )
        )
    finally:
        r.httpx.AsyncClient = orig_http

    # Must go to DashScope, not Gemini.
    assert captured["url"].endswith("/compatible-mode/v1/chat/completions")
    assert "dashscope-intl" in captured["url"]
    assert resp.status_code == 200


def test_proxy_to_gemini_strips_deepseek_params(monkeypatch):
    from backend.proxy import router
    from backend.config import settings

    captured = {}

    def handler(request):
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    transport = httpx.MockTransport(handler)

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(router.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(router, "_log_usage", _noop)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "gemini_url", "https://fake.example")

    body = {
        "model": "deepseek-v4-pro",
        "stream": False,
        "reasoning": {"effort": "high"},
        "output_config": {"effort": "high"},
        "reasoning_effort": "high",
        "thinking": {"type": "enabled"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is in this image?"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ],
            }
        ],
    }

    asyncio.run(router._proxy_to_gemini(None, "user-1", body, False, 10))

    sent = captured["json"]
    assert sent.get("reasoning") is None
    assert sent.get("output_config") is None
    assert sent.get("reasoning_effort") is None
    assert sent.get("thinking") is None
    assert sent["model"] == "gemini-2.5-flash"
    content = sent["messages"][0]["content"]
    assert content[1]["type"] == "image_url"


def test_responses_vision_requires_gemini_key(client, api_key):
    r = client.post(
        "/v1/responses",
        json={
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "What is in this image?"},
                        {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
                    ],
                }
            ]
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "Vision is not configured" in r.text


def test_responses_vision_routes_to_gemini_chat(monkeypatch):
    from backend.proxy import router
    from backend.config import settings

    captured = {}

    def handler(request):
        captured["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-1",
                "choices": [{"message": {"content": "A cat."}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
            },
        )

    transport = httpx.MockTransport(handler)

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(router.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(router, "_log_usage", _noop)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "gemini_url", "https://fake.example")

    body = {
        "model": "deepseek-v4-pro",
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "What is in this image?"},
                    {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
                ],
            }
        ],
    }

    async def run():
        from starlette.responses import JSONResponse

        res = await router._proxy_gemini_responses(None, "user-1", body, False, 10)
        assert isinstance(res, JSONResponse)
        payload = json.loads(res.body)
        assert payload["object"] == "response"
        assert payload["model"] == "gemini-2.5-flash"
        assert payload["output"][0]["content"][0]["text"] == "A cat."
        assert payload["usage"]["total_tokens"] == 15

    asyncio.run(run())

    sent = captured["json"]
    assert sent["model"] == "gemini-2.5-flash"
    assert sent["stream"] is False
    content = sent["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "What is in this image?"}
    assert content[1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}


def test_responses_vision_stream_translates_events(monkeypatch):
    from backend.proxy import router
    from backend.config import settings

    captured = {}

    def handler(request):
        captured["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            stream=httpx.ByteStream(
                b'data: {"choices":[{"delta":{"content":"A ca"}}]}\n\n'
                b'data: {"choices":[{"delta":{"content":"t."}}]}\n\n'
                b'data: [DONE]\n\n'
            ),
        )

    transport = httpx.MockTransport(handler)

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(router.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(router, "_log_usage", _noop)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-2.5-flash")
    monkeypatch.setattr(settings, "gemini_url", "https://fake.example")

    body = {
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "What is in this image?"},
                    {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
                ],
            }
        ]
    }

    async def run():
        from starlette.responses import StreamingResponse

        res = await router._proxy_gemini_responses(None, "user-1", body, True, 10)
        assert isinstance(res, StreamingResponse)
        chunks = [chunk async for chunk in res.body_iterator]
        text = "".join(c if isinstance(c, str) else c.decode() for c in chunks)
        assert "event: response.created" in text
        assert "event: response.output_text.delta" in text
        assert '"delta": "A ca"' in text
        assert '"delta": "t."' in text
        assert "event: response.completed" in text
        assert '"status": "completed"' in text
        assert '"text": "A cat."' in text

    asyncio.run(run())

    assert captured["json"]["stream"] is True


def test_anthropic_to_chat_messages():
    messages = _anthropic_to_chat_messages(
        {
            "system": "You are helpful.",
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": [{"type": "text", "text": "hello"}]},
            ],
        }
    )
    assert messages[0] == {"role": "system", "content": "You are helpful."}
    assert messages[1] == {"role": "user", "content": "hi"}
    assert messages[2] == {"role": "assistant", "content": [{"type": "text", "text": "hello"}]}


def test_anthropic_image_block_to_chat():
    messages = _anthropic_to_chat_messages(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What is this?"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"},
                        },
                    ],
                }
            ]
        }
    )
    parts = messages[0]["content"]
    assert parts[0] == {"type": "text", "text": "What is this?"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"] == "data:image/png;base64,AAAA"


def test_anthropic_tool_result_to_tool_message():
    messages = _anthropic_to_chat_messages(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_1", "content": "45 deg"},
                    ],
                }
            ]
        }
    )
    assert messages[0] == {"role": "tool", "tool_call_id": "toolu_1", "content": "45 deg"}


def test_anthropic_tools_to_chat():
    tools = _anthropic_tools_to_chat(
        [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Get weather",
                "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
            }
        ]
    )
    assert tools[0]["type"] == "function"
    assert tools[0]["function"]["name"] == "get_weather"
    assert tools[0]["function"]["parameters"]["type"] == "object"


def test_anthropic_chat_payload_shape():
    payload = _anthropic_chat_payload(
        {
            "model": "deepseek-v4-flash",
            "system": "sys",
            "max_tokens": 256,
            "temperature": 0.5,
            "stop_sequences": ["END"],
            "messages": [{"role": "user", "content": "hi"}],
        }
    )
    assert payload["model"] == "deepseek-v4-flash"
    assert payload["max_tokens"] == 256
    assert payload["temperature"] == 0.5
    assert payload["stop"] == ["END"]
    assert payload["messages"][0] == {"role": "system", "content": "sys"}
    assert payload["messages"][1] == {"role": "user", "content": "hi"}


def test_anthropic_build_message_with_tool_calls():
    msg = _build_anthropic_message(
        "deepseek-v4-flash",
        "I will check.",
        [{"id": "call_1", "name": "get_weather", "arguments": '{"city":"Bangkok"}'}],
        "tool_calls",
    )
    assert msg["stop_reason"] == "tool_use"
    assert msg["content"][0]["type"] == "text"
    assert msg["content"][1] == {
        "type": "tool_use",
        "id": "call_1",
        "name": "get_weather",
        "input": {"city": "Bangkok"},
    }


def test_anthropic_mock_non_stream(client, api_key):
    r = client.post(
        "/v1/messages",
        json={"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "message"
    assert data["role"] == "assistant"
    assert data["content"][0]["type"] == "text"
    assert "usage" in data


def test_anthropic_mock_stream(client, api_key):
    r = client.post(
        "/v1/messages",
        json={
            "model": "deepseek-v4-flash",
            "stream": True,
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    body = r.text
    assert "event: message_start" in body
    assert "event: content_block_start" in body
    assert "event: content_block_delta" in body
    assert "event: message_delta" in body
    assert "event: message_stop" in body


def test_anthropic_chunk_to_events_text():
    from backend.proxy.router import _anthropic_chat_chunk_to_events, _emit_anthropic_message_stop

    meta = {"output_text": [], "tool_calls": [], "block_started": False}
    chunk1 = b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
    chunk2 = b'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
    events = _anthropic_chat_chunk_to_events(chunk1, meta) + _anthropic_chat_chunk_to_events(chunk2, meta)
    sse = "".join(events)
    assert "event: content_block_start" in sse
    assert '"type": "text_delta"' in sse
    assert '"text": "Hel"' in sse
    assert '"text": "lo"' in sse
    assert meta["output_text"] == ["Hel", "lo"]
    tail = _emit_anthropic_message_stop(meta, "stop")
    assert "event: content_block_stop" in tail
    assert "event: message_delta" in tail
    assert '"stop_reason": "end_turn"' in tail
    assert "event: message_stop" in tail


def test_anthropic_chunk_to_events_tool_call():
    from backend.proxy.router import _anthropic_chat_chunk_to_events

    meta = {"output_text": [], "tool_calls": [], "block_started": False}
    chunk = (
        b'data: {"choices":[{"delta":{"tool_calls":[{"function":'
        b'{"name": "get_weather", "arguments": "{\\"city\\": \\"Bangkok\\"}"}}]}}]}\n\n'
    )
    _anthropic_chat_chunk_to_events(chunk, meta)
    assert meta["tool_calls"][0]["name"] == "get_weather"
    assert meta["tool_calls"][0]["arguments"] == '{"city": "Bangkok"}'


def test_anthropic_chunk_to_events_ignores_done():
    from backend.proxy.router import _anthropic_chat_chunk_to_events

    meta = {"output_text": [], "tool_calls": [], "block_started": False}
    assert _anthropic_chat_chunk_to_events(b"data: [DONE]\n\n", meta) == []


def test_anthropic_vision_requires_gemini_key(client, api_key):
    r = client.post(
        "/v1/messages",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What is this?"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"},
                        },
                    ],
                }
            ]
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 503
    assert "Vision is not configured" in r.text


def test_anthropic_accepts_x_api_key_header(client, api_key):
    r = client.post(
        "/v1/messages",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    assert r.status_code == 200
    assert r.json()["type"] == "message"


def test_resolve_model_alias():
    from backend.proxy.router import _resolve_model

    assert _resolve_model("claude-sonnet-4-5") == "deepseek-v4-pro"
    assert _resolve_model("claude-haiku-4-5") == "deepseek-v4-flash"
    assert _resolve_model("deepseek-v4-flash") == "deepseek-v4-flash"


def test_models_lists_claude_aliases(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    ids = [m["id"] for m in r.json()["data"]]
    assert "claude-sonnet-4-5" in ids
    assert "deepseek-v4-pro" in ids


def test_image_seed_is_stable():
    assert _image_seed("a cat") == _image_seed("a cat")
    assert _image_seed("a cat") != _image_seed("a dog")


def test_mock_image_b64_is_valid_svg():
    import base64 as b64mod

    b64 = _mock_image_b64("a fox", "dall-e-3", "512x512", "seed")
    svg = b64mod.b64decode(b64).decode("utf-8")
    assert svg.startswith("<svg")
    assert "</svg>" in svg
    assert "a fox" in svg


def test_mock_image_svg_sizes():
    assert 'width="512"' in _mock_image_svg("p", "m", "512x512", "s")
    assert 'width="1024"' in _mock_image_svg("p", "m", "1024x1024", "s")
    assert 'width="1792"' in _mock_image_svg("p", "m", "1792x1024", "s")


def test_image_generations_requires_session(client):
    r = client.post("/v1/images/generations", json={"prompt": "a cat"})
    assert r.status_code == 401


def test_image_generations_mock_url(client, api_key):
    r = client.post(
        "/v1/images/generations",
        json={"prompt": "a cat", "model": "dall-e-3", "size": "512x512", "n": 2},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] > 0
    assert len(body["data"]) == 2
    for item in body["data"]:
        assert item["url"].startswith("data:image/svg+xml;base64,")
    assert body["data"][0]["revised_prompt"] == "a cat"


def test_image_generations_mock_b64_json(client, api_key):
    r = client.post(
        "/v1/images/generations",
        json={"prompt": "a cat", "response_format": "b64_json"},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "b64_json" in body["data"][0]


def test_image_generations_requires_prompt(client, api_key):
    r = client.post(
        "/v1/images/generations",
        json={"model": "dall-e-3"},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 400


def test_wants_image_detects_thai():
    assert _wants_image({"messages": [{"role": "user", "content": "ช่วยสร้างรูปแมวหน่อย"}]})
    assert _wants_image({"messages": [{"role": "user", "content": "วาดรูปภูเขาให้ฉัน"}]})
    assert not _wants_image({"messages": [{"role": "user", "content": "ช่วยอธิบายเรื่อง AI หน่อย"}]})


def test_wants_image_detects_english():
    assert _wants_image({"messages": [{"role": "user", "content": "generate an image of a cat"}]})
    assert _wants_image({"messages": [{"role": "user", "content": "create a picture of the ocean"}]})
    assert _wants_image({"messages": [{"role": "user", "content": "draw a logo"}]})
    assert not _wants_image({"messages": [{"role": "user", "content": "summarize the document"}]})


def test_wants_image_ignores_assistant_and_no_messages():
    assert not _wants_image({"messages": []})
    assert not _wants_image({"messages": [{"role": "assistant", "content": "สร้างรูปอะไรดี"}]})


def test_wants_image_uses_only_last_user_message():
    body = {
        "messages": [
            {"role": "user", "content": "hello there"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "generate an image please"},
        ]
    }
    assert _wants_image(body)


def test_image_tool_loop_mock_non_stream(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "สร้างรูปสุนัขนั่งเล่น"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    content = body["choices"][0]["message"]["content"]
    assert "data:image/svg+xml;base64," in content
    assert r.headers["content-type"].startswith("application/json")


def test_image_tool_loop_mock_stream(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "วาดรูปท้องฟ้าตอนกลางคืน"}], "stream": True},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text
    body = r.text
    assert "data: [DONE]" in body
    assert "chatcmpl-img" in body


def test_image_tool_loop_preserves_normal_chat(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "สวัสดี"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200, r.text
    content = r.json()["choices"][0]["message"]["content"]
    assert "data:image/svg+xml;base64," not in content


def test_parse_image_toolcall_bare_json():
    out = _parse_image_toolcall(
        '{"content": "A fluffy orange tabby eats pizza", "tool_call": "image_gen", "size": "1024x1024"}'
    )
    assert out is not None
    assert out["content"] == "A fluffy orange tabby eats pizza"
    assert out["tool_call"] == "image_gen"
    assert out["size"] == "1024x1024"


def test_parse_image_toolcall_with_fence():
    out = _parse_image_toolcall('```json\n{"content": "cat", "tool_call": "image_gen"}\n```')
    assert out is not None
    assert out["content"] == "cat"
    assert out["size"] == "1024x1024"


def test_parse_image_toolcall_with_prose():
    out = _parse_image_toolcall(
        'Here is the prompt: {"content": "sunset beach", "tool_call": "image_gen", "size": "1792x1024"}'
    )
    assert out is not None
    assert out["content"] == "sunset beach"
    assert out["size"] == "1792x1024"


def test_parse_image_toolcall_rejects_non_image_gen():
    assert _parse_image_toolcall('{"content": "x", "tool_call": "other"}') is None
    assert _parse_image_toolcall('{"content": "x"}') is None
    assert _parse_image_toolcall("plain text") is None
    assert _parse_image_toolcall("") is None


def test_parse_image_toolcall_rejects_missing_content():
    assert _parse_image_toolcall('{"tool_call": "image_gen"}') is None


def test_models_list_has_image_models(client):
    r = client.get("/v1/models")
    ids = [m["id"] for m in r.json()["data"]]
    assert "gpt-image-1" in ids
    assert "dall-e-3" in ids


def test_parse_wants_image():
    assert _parse_wants_image('{"wants_image": true}') is True
    assert _parse_wants_image('```json\n{"wants_image": false}\n```') is False
    assert _parse_wants_image('Here: {"wants_image": true}') is True
    assert _parse_wants_image("") is None
    assert _parse_wants_image("plain text") is None
    assert _parse_wants_image('{"wants_image": "yes"}') is None


def _install_fake_client(monkeypatch, body):
    from backend.proxy import router as proxy_router

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            return httpx.Response(200, json=body)

    monkeypatch.setattr(proxy_router.settings, "deepseek_api_key", "sk-test")
    monkeypatch.setattr(proxy_router.httpx, "AsyncClient", FakeClient)
    return proxy_router


def test_classify_image_intent_returns_true_with_context(monkeypatch):
    proxy_router = _install_fake_client(
        monkeypatch, {"choices": [{"message": {"content": '{"wants_image": true}'}}]}
    )
    result = asyncio.run(
        proxy_router._classify_image_intent(
            [
                {"role": "user", "content": "create a thumbnail for my new video"},
                {"role": "assistant", "content": "sure, tell me the topic"},
                {"role": "user", "content": "it's about cooking"},
            ]
        )
    )
    assert result is True


def test_classify_image_intent_returns_false(monkeypatch):
    proxy_router = _install_fake_client(
        monkeypatch, {"choices": [{"message": {"content": '{"wants_image": false}'}}]}
    )
    result = asyncio.run(
        proxy_router._classify_image_intent([{"role": "user", "content": "explain docker"}])
    )
    assert result is False


def test_classify_image_intent_none_when_no_key(monkeypatch):
    from backend.proxy import router as proxy_router

    monkeypatch.setattr(proxy_router.settings, "deepseek_api_key", "")
    monkeypatch.setattr(proxy_router.settings, "gemini_api_key", "")
    result = asyncio.run(
        proxy_router._classify_image_intent([{"role": "user", "content": "draw an apple"}])
    )
    assert result is None


def test_classify_image_intent_none_on_unparseable(monkeypatch):
    proxy_router = _install_fake_client(
        monkeypatch, {"choices": [{"message": {"content": "I think so"}}]}
    )
    result = asyncio.run(
        proxy_router._classify_image_intent([{"role": "user", "content": "draw an apple"}])
    )
    assert result is None


def test_detect_image_intent_falls_back_to_regex(monkeypatch):
    proxy_router = _install_fake_client(
        monkeypatch, {"choices": [{"message": {"content": "sorry"}}]}
    )
    result = asyncio.run(
        proxy_router._detect_image_intent([{"role": "user", "content": "generate an image of a cat"}])
    )
    assert result is True


def test_detect_image_intent_false_when_no_keyword(monkeypatch):
    proxy_router = _install_fake_client(
        monkeypatch, {"choices": [{"message": {"content": "ok sure"}}]}
    )
    result = asyncio.run(
        proxy_router._detect_image_intent([{"role": "user", "content": "summarize the document"}])
    )
    assert result is False


def test_image_source_mock_default_no_network(monkeypatch):
    from backend.proxy import router as proxy_router

    monkeypatch.setattr(proxy_router.settings, "image_provider", "mock")
    result = asyncio.run(proxy_router._image_source("a cat", "dall-e-3", "512x512", "seed"))
    assert result["kind"] == "data_uri"
    assert result["ref"].startswith("data:image/svg+xml;base64,")


def test_image_source_unsplash_without_key_falls_back_to_mock(monkeypatch):
    from backend.proxy import router as proxy_router

    monkeypatch.setattr(proxy_router.settings, "image_provider", "unsplash")
    monkeypatch.setattr(proxy_router.settings, "unsplash_access_key", "")
    result = asyncio.run(proxy_router._image_source("a cat", "dall-e-3", "512x512", "seed"))
    assert result["kind"] == "data_uri"


def test_image_source_unsplash_returns_url(monkeypatch):
    from backend.proxy import router as proxy_router

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, **kwargs):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"urls": {"raw": "https://images.unsplash.com/photo-1"}}
                    ]
                },
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(proxy_router.settings, "image_provider", "unsplash")
    monkeypatch.setattr(proxy_router.settings, "unsplash_access_key", "sk-test")
    monkeypatch.setattr(proxy_router.httpx, "AsyncClient", FakeClient)
    result = asyncio.run(proxy_router._image_source("a cat", "dall-e-3", "512x512", "seed"))
    assert result["kind"] == "url"
    assert "images.unsplash.com" in result["ref"]
    assert "w=512&h=512" in result["ref"]
    assert "fit=crop" in result["ref"]


def test_loremflickr_url_with_non_ascii_prompt():
    url = _loremflickr_url("แมวน่ารัก", "1024x1024", "seed")
    assert url.startswith("https://loremflickr.com/1024/1024/nature?lock=")
    url2 = _loremflickr_url("a red fox in the snow", "512x512", "seed")
    assert url2.startswith("https://loremflickr.com/512/512/a-red-fox-in-the?lock=")


def test_image_source_dashscope_without_key_falls_back_to_mock(monkeypatch):
    from backend.proxy import router as proxy_router

    monkeypatch.setattr(proxy_router.settings, "image_provider", "dashscope")
    monkeypatch.setattr(proxy_router.settings, "dashscope_api_key", "")
    result = asyncio.run(proxy_router._image_source("a cat", "dall-e-3", "512x512", "seed"))
    assert result["kind"] == "data_uri"
    assert result["ref"].startswith("data:image/svg+xml;base64,")


def test_image_source_dashscope_returns_data_uri(monkeypatch):
    from backend.proxy import router as proxy_router

    async def fake_dashscope_image(prompt, size):
        return {"ref": "data:image/png;base64,AAAB", "kind": "data_uri"}

    monkeypatch.setattr(proxy_router.settings, "image_provider", "dashscope")
    monkeypatch.setattr(proxy_router.settings, "dashscope_api_key", "sk-test")
    monkeypatch.setattr(proxy_router, "_dashscope_image", fake_dashscope_image)
    result = asyncio.run(proxy_router._image_source("a cat", "dall-e-3", "512x512", "seed"))
    assert result["kind"] == "data_uri"
    assert result["ref"].startswith("data:image/png;base64,")


def test_dashscope_image_size_format():
    from backend.proxy.router import _dashscope_image_size, _parse_size

    assert _dashscope_image_size("1024x1024") == "1024*1024"
    assert _dashscope_image_size("512x512") == "512*512"
    assert _dashscope_image_size("") == "1024*1024"
    assert _parse_size("1024*1024") == (1024, 1024)


def test_stream_image_markdown_emits_image_in_few_chunks():
    """A large base64 image must NOT be streamed char-by-char.

    Regression: previously a 1.6MB data URI produced ~1.7M SSE chunks and hung
    the client. Now the image markdown is emitted as a single delta.
    """
    from backend.proxy.router import _stream_image_markdown

    uri = "data:image/png;base64," + "A" * 1_600_000
    gen = _stream_image_markdown("สร้างรูปให้แล้วครับ", uri, 12345, "deepseek-v4-flash")

    async def collect():
        chunks = []
        async for c in gen:
            chunks.append(c)
        return chunks

    chunks = asyncio.run(collect())
    # 1 first + 1 image delta + 1 final + 1 [DONE] (+ text chars, Thai text is short)
    assert len(chunks) < 50, f"expected few chunks, got {len(chunks)}"
    joined = "".join(c if isinstance(c, str) else c.decode(errors="replace") for c in chunks)
    assert uri in joined  # the full image must be present
    assert str(chunks[-1]).strip() == "data: [DONE]"


async def _collect(agen):
    chunks = []
    async for c in agen:
        chunks.append(c)
    return chunks


def test_deadline_wrapper_passes_through(monkeypatch):
    from backend.proxy import router as proxy_router

    async def gen():
        yield b"data: one\n\n"
        yield b"data: [DONE]\n\n"

    chunks = asyncio.run(_collect(proxy_router._deadline_wrapper(gen(), max_seconds=30)))
    assert chunks == [b"data: one\n\n", b"data: [DONE]\n\n"]


def test_deadline_wrapper_ends_early_on_max_time(monkeypatch):
    from backend.proxy import router as proxy_router

    async def endless():
        while True:
            yield b"data: {}\n\n"
            await asyncio.sleep(0.01)

    monkeypatch.setattr(proxy_router, "STREAM_IDLE_SECONDS", 9999)
    chunks = asyncio.run(_collect(proxy_router._deadline_wrapper(endless(), max_seconds=0.05)))
    # Always ends (never hangs) and terminates with a [DONE].
    assert chunks
    assert b"[DONE]" in chunks[-1]


def test_deadline_wrapper_ends_on_idle(monkeypatch):
    from backend.proxy import router as proxy_router

    async def stall_then_done():
        yield b"data: hi\n\n"
        await asyncio.sleep(5)

    monkeypatch.setattr(proxy_router, "STREAM_IDLE_SECONDS", 0.05)
    chunks = asyncio.run(_collect(proxy_router._deadline_wrapper(stall_then_done(), max_seconds=30)))
    assert chunks
    assert b"[DONE]" in chunks[-1]


def test_deadline_wrapper_handles_upstream_exception(monkeypatch):
    from backend.proxy import router as proxy_router

    async def boom():
        yield b"data: partial\n\n"
        raise RuntimeError("upstream died")

    chunks = asyncio.run(_collect(proxy_router._deadline_wrapper(boom(), max_seconds=30)))
    assert chunks
    assert b"[DONE]" in chunks[-1]


def test_chat_completions_sets_max_tokens_default(client, api_key):
    """A request without max_tokens gets a safe default cap applied."""
    import backend.proxy.router as r

    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [{"message": {"content": "ok", "role": "assistant"}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 1},
            }

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    class FakeDB:
        async def execute(self, *a, **k):
            return FakeResult()

        async def commit(self):
            pass

        async def add(self, *a, **k):
            pass

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["body"] = json
            return FakeResponse()

    orig_http = r.httpx.AsyncClient
    orig_key = r.settings.deepseek_api_key
    r.httpx.AsyncClient = lambda *a, **k: FakeClient()
    r.settings.deepseek_api_key = "test-key"
    try:
        asyncio.run(
            r._handle_chat_completions(
                FakeDB(), "u1", {"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "hi"}]}
            )
        )
    finally:
        r.httpx.AsyncClient = orig_http
        r.settings.deepseek_api_key = orig_key

    assert captured["body"]["max_tokens"] == 4096
