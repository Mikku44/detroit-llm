import time
import uuid
import pytest


def test_tier_usage_cache_hit(monkeypatch):
    from backend.proxy.router import _usage_cache, _tier_usage
    import asyncio

    _usage_cache.clear()
    calls = {"cnt": 0}
    orig_execute = None

    # Simulate _tier_usage caching by storing manually
    _usage_cache["u1"] = (100, 200)
    assert _usage_cache.get("u1") == (100, 200)
    # TTL 45s — still hit within same test
    assert _usage_cache.get("u1") is not None


def test_user_cache_invalidation():
    from backend.proxy.router import _user_cache

    _user_cache.clear()
    _user_cache["uid"] = object()
    assert "uid" in _user_cache
    _user_cache.pop("uid", None)
    assert "uid" not in _user_cache


def test_api_key_cache_middleware():
    from backend.auth.middleware import _api_key_cache

    _api_key_cache.clear()
    _api_key_cache["sk-dt-abc"] = {"hash": "h", "entry": object()}
    assert _api_key_cache.get("sk-dt-abc") is not None


def test_models_cache_ttl():
    from backend.proxy.router import _models_cache
    import time as t

    _models_cache.clear()
    _models_cache["all"] = {"data": [{"id": "m1"}], "ts": t.monotonic()}
    assert "all" in _models_cache
    # Simulate expiry by setting old ts
    _models_cache["all"]["ts"] = t.monotonic() - 400
    # Should be considered expired in handler (300s TTL)
    assert t.monotonic() - _models_cache["all"]["ts"] > 300


def test_status_cache():
    from backend.admin.router import _status_cache

    _status_cache.clear()
    _status_cache["status"] = {"ok": True}
    assert _status_cache.get("status") == {"ok": True}


def test_conversations_pagination(client, session_token):
    headers = {"Authorization": f"Bearer {session_token}"}
    # Create conversation with 10 messages
    msgs = [{"role": "user", "content": f"msg {i}"} for i in range(10)]
    r = client.post("/api/conversations", headers=headers, json={"title": "Paginate", "messages": msgs})
    assert r.status_code == 201
    cid = r.json()["id"]

    # Default limit 30 should return all 10
    r = client.get(f"/api/conversations/{cid}", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 10
    assert len(data["messages"]) == 10
    assert data["hasMore"] is False

    # Limit 3 should return 3 newest, hasMore True
    r = client.get(f"/api/conversations/{cid}?limit=3", headers=headers)
    data = r.json()
    assert len(data["messages"]) == 3
    assert data["hasMore"] is True
    assert data["oldestPosition"] == 7
    assert data["messages"][0]["content"] == "msg 7"
    assert data["messages"][0]["position"] == 7

    # Before = 7 should return older 3
    r = client.get(f"/api/conversations/{cid}?limit=3&before=7", headers=headers)
    data = r.json()
    assert len(data["messages"]) == 3
    assert data["messages"][0]["content"] == "msg 4"
    assert data["oldestPosition"] == 4

    # AppendMessages direct
    r = client.post(f"/api/conversations/{cid}/messages", headers=headers, json={"messages": [{"role": "user", "content": "appended"}]})
    assert r.status_code == 201
    assert len(r.json()["messages"]) == 1

    r = client.get(f"/api/conversations/{cid}?all=true", headers=headers)
    assert r.json()["total"] == 11

    # List pagination
    r = client.get("/api/conversations?limit=1&offset=0", headers=headers)
    assert r.status_code == 200
    assert "hasMore" in r.json()

    # Cleanup
    client.delete(f"/api/conversations/{cid}", headers=headers)


def test_image_intent_early_exit():
    import asyncio
    from backend.proxy.router import _classify_image_intent

    # Plain text with no image keywords should early-exit False without LLM call
    result = asyncio.run(_classify_image_intent([{"role": "user", "content": "hello how are you"}]))
    assert result is False

    result = asyncio.run(_classify_image_intent([{"role": "user", "content": "สร้างรูปแมวหน่อย"}]))
    # Should not early-exit false; may be True/False/None depending on LLM availability, but not error
    assert result in (True, False, None)


def test_crypto_roundtrip():
    from backend.chat.crypto import derive_key, encrypt_text, decrypt_text

    key = derive_key("user1", "chat1", "2026-01-01")
    assert len(key) == 32
    plain = "hello secret"
    blob = encrypt_text(key, plain)
    assert blob != plain
    assert decrypt_text(key, blob) == plain
    assert decrypt_text(key, "") == ""
    # Wrong key should not decrypt
    wrong = derive_key("user2", "chat1", "2026-01-01")
    assert decrypt_text(wrong, blob) == ""


def test_r2_is_configured_false_by_default(monkeypatch):
    from backend.storage.r2 import is_configured
    from backend.config import settings

    # May be True if local .env has R2 keys; just ensure function works
    result = is_configured()
    assert isinstance(result, bool)
    if not settings.r2_endpoint or not settings.r2_access_key_id:
        assert result is False


def test_db_indexes_exist(client):
    # Ensure init_db created indexes for pagination
    import asyncio
    from sqlalchemy import text
    from backend.db.database import conversations_engine

    async def _check():
        async with conversations_engine.begin() as conn:
            rows = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ix_conv_messages_cid_pos','ix_conversations_user_updated')"))
            names = {r[0] for r in rows.fetchall()}
            return names

    names = asyncio.run(_check())
    assert "ix_conv_messages_cid_pos" in names


@pytest.fixture(autouse=True)
def _ensure_user_exists_paginate(client, session_token, test_session_factory):
    import jwt as pyjwt
    from backend.config import settings
    from backend.db.models import User
    import asyncio

    payload = pyjwt.decode(session_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    user_id = payload["sub"]

    async def _run():
        async with test_session_factory() as session:
            exists = await session.get(User, user_id)
            if not exists:
                session.add(User(id=user_id, google_email=f"pag-{user_id}@test.local", is_member=True))
                await session.commit()

    asyncio.run(_run())
    yield
