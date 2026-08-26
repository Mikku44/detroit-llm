import asyncio
import uuid

import httpx

from backend.auth.youtube import (
    _persist_env,
    _load_persisted_env,
    _is_owner,
    _fetch_member_channel_ids,
    YOUTUBE_MEMBERS_API,
)


# --- _persist_env -------------------------------------------------------------


def test_persist_env_writes_to_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.auth.youtube.settings.data_dir", str(tmp_path))

    _persist_env("OWNER_REFRESH_TOKEN", "tok-1")
    assert (tmp_path / "OWNER_REFRESH_TOKEN").read_text(encoding="utf-8") == "tok-1"

    _persist_env("OWNER_REFRESH_TOKEN", "tok-2")
    assert (tmp_path / "OWNER_REFRESH_TOKEN").read_text(encoding="utf-8") == "tok-2"
    # atomic write leaves no temp files behind
    assert not list(tmp_path.glob("*.tmp"))


def test_persist_env_round_trips_problematic_values(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.auth.youtube.settings.data_dir", str(tmp_path))
    weird = 'tok-2"#weird\nvalue'
    _persist_env("OWNER_REFRESH_TOKEN", weird)

    assert _load_persisted_env("OWNER_REFRESH_TOKEN") == weird


# --- _fetch_member_channel_ids ------------------------------------------------


def _run_fetch(handler):
    transport = httpx.MockTransport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await _fetch_member_channel_ids(client, "test-token")

    return asyncio.run(run())


def test_fetch_member_collects_ids_and_skips_missing():
    seen = {}

    def handler(request):
        seen["headers"] = request.headers.get("Authorization", "")
        seen["params"] = dict(request.url.params)
        items = [
            {"snippet": {"memberDetails": {"channelId": "UC-1"}}},
            {"snippet": {}},  # no memberDetails
            {"snippet": {"memberDetails": {}}},  # no channelId
            "not-a-dict",
            {"snippet": {"memberDetails": {"channelId": "UC-1"}}},  # duplicate
        ]
        return httpx.Response(200, json={"items": items})

    result = _run_fetch(handler)

    assert result == {"UC-1"}
    assert seen["headers"] == "Bearer test-token"
    assert seen["params"]["part"] == "snippet"
    assert seen["params"]["mode"] == "all_current"
    assert seen["params"]["maxResults"] == "200"


def test_fetch_member_paginates_with_page_token():
    calls = []

    def handler(request):
        page = dict(request.url.params).get("pageToken")
        calls.append(page)
        if not page:
            return httpx.Response(
                200,
                json={
                    "items": [{"snippet": {"memberDetails": {"channelId": "UC-a"}}}],
                    "nextPageToken": "tok-2",
                },
            )
        return httpx.Response(
            200,
            json={"items": [{"snippet": {"memberDetails": {"channelId": "UC-b"}}}]},
        )

    result = _run_fetch(handler)

    assert result == {"UC-a", "UC-b"}
    assert calls == [None, "tok-2"]


def test_fetch_member_returns_empty_on_no_items():
    def handler(request):
        return httpx.Response(200, json={"items": []})

    assert _run_fetch(handler) == set()


def test_fetch_member_breaks_on_api_error():
    def handler(request):
        return httpx.Response(500, json={"error": {"message": "quota exceeded"}})

    assert _run_fetch(handler) == set()


def test_fetch_member_hits_youtube_members_endpoint():
    requested = []

    def handler(request):
        requested.append(str(request.url))
        return httpx.Response(200, json={})

    _run_fetch(handler)

    assert [r.split("?")[0] for r in requested] == [YOUTUBE_MEMBERS_API]


def test_fetch_member_logs_exchange(capsys):
    """Run the real function against a simulated YouTube API and log the exchanges.

    Run with `pytest -s` to see the full request/response log on stdout.
    """
    log = []

    def handler(request):
        page = dict(request.url.params).get("pageToken")
        if not page:
            resp = httpx.Response(
                200,
                json={
                    "items": [{"snippet": {"memberDetails": {"channelId": "UC-1"}}}],
                    "nextPageToken": "tok-2",
                },
            )
        else:
            resp = httpx.Response(
                200,
                json={"items": [{"snippet": {"memberDetails": {"channelId": "UC-2"}}}]},
            )
        log.append(
            f"--> {request.method} {request.url}\n"
            f"    Authorization: {request.headers.get('Authorization')}\n"
            f"    <-- {resp.status_code} {resp.json()}"
        )
        return resp

    transport = httpx.MockTransport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await _fetch_member_channel_ids(client, "test-token")

    result = asyncio.run(run())

    print("\n--- _fetch_member_channel_ids exchange log ---")
    for line in log:
        print(line)
    print("--- end log ---\n")

    assert result == {"UC-1", "UC-2"}
    assert len(log) == 2


def test_is_owner_only_matches_non_empty_email(monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "owner_google_email", "owner@example.com")
    assert _is_owner("owner@example.com") is True
    assert _is_owner("Owner@Example.COM") is True
    assert _is_owner("other@example.com") is False
    assert _is_owner("") is False

    monkeypatch.setattr(settings, "owner_google_email", "")
    assert _is_owner("") is False
    assert _is_owner("owner@example.com") is False


# --- /auth/youtube/callback ---------------------------------------------------


def test_callback_missing_code_returns_400(client):
    r = client.get("/auth/youtube/callback")
    assert r.status_code == 400
    assert r.json()["detail"] == "Missing authorization code"


def test_callback_oauth_error_redirects_to_configured_dashboard(client, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "dashboard_url", "https://chat.khain.app")
    r = client.get(
        "/auth/youtube/callback",
        params={"error": "access_denied", "state": "redirect=dashboard"},
        follow_redirects=False,
    )
    assert r.status_code in (302, 303, 307)
    assert r.headers["location"] == "https://chat.khain.app/callback?error=access_denied"


def test_callback_oauth_error_never_redirects_to_localhost(client):
    """With the default (localhost) DASHBOARD_URL, derive the base from the request host."""
    from backend.config import settings

    assert "localhost" in settings.dashboard_url  # dev default
    r = client.get(
        "/auth/youtube/callback",
        params={"error": "access_denied", "state": "redirect=dashboard"},
        follow_redirects=False,
    )
    assert r.status_code in (302, 303, 307)
    loc = r.headers["location"]
    assert "localhost" not in loc and "127.0.0.1" not in loc
    assert loc.startswith(f"{client.base_url}/callback?error=")


def test_callback_oauth_error_without_redirect_returns_400(client):
    r = client.get("/auth/youtube/callback", params={"error": "access_denied"})
    assert r.status_code == 400
    assert "OAuth error" in r.json()["detail"]


def test_callback_localhost_dev_keeps_configured_dashboard(monkeypatch):
    """Local dev: callback on :8000, configured SPA on :5173 -> stay on :5173."""
    from fastapi.testclient import TestClient

    from backend.config import settings
    from backend.main import app

    monkeypatch.setattr(settings, "dashboard_url", "http://localhost:5173")
    client = TestClient(app, base_url="http://localhost:8000")
    r = client.get(
        "/auth/youtube/callback",
        params={"error": "access_denied", "state": "redirect=dashboard"},
        follow_redirects=False,
    )
    assert r.status_code in (302, 303, 307)
    assert r.headers["location"] == "http://localhost:5173/callback?error=access_denied"


async def test_callback_happy_path_covers_existing_user(
    client,
    monkeypatch,
    db_session,
):
    from backend.db.models import User
    from sqlalchemy import select

    sub = f"sub-{uuid.uuid4().hex}"

    async def _fake_exchange(_client, _code):
        return {"access_token": "at", "refresh_token": None, "id_token": ""}

    async def _fake_user(_client, _token):
        return {"email": "member@member.com", "id": sub, "name": "Member", "picture": ""}

    async def _fake_channel(_client, _token):
        return "UC-123"

    async def _fake_member(_client, _channel_id):
        return True

    monkeypatch.setattr("backend.auth.youtube._exchange_code", _fake_exchange)
    monkeypatch.setattr("backend.auth.youtube._get_google_user", _fake_user)
    monkeypatch.setattr("backend.auth.youtube._get_user_channel_id", _fake_channel)
    monkeypatch.setattr("backend.auth.youtube._is_youtube_member", _fake_member)

    # First login: new user created, dashboard redirect with a token.
    r1 = client.get(
        "/auth/youtube/callback",
        params={"code": "c1", "state": "redirect=dashboard"},
        follow_redirects=False,
    )
    assert r1.status_code in (302, 303, 307)
    # Token must be in the URL fragment (#token=), never the query string.
    assert "#token=" in r1.headers["location"]
    assert "?token=" not in r1.headers["location"]

    # Second login for the same google_sub hits the update branch.
    r2 = client.get(
        "/auth/youtube/callback",
        params={"code": "c2"},
        follow_redirects=False,
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "authenticated"
    assert body["user"]["email"] == "member@member.com"
    assert body["user"]["is_owner"] is False
    assert body["user"]["is_member"] is True

    result = await db_session.execute(select(User).where(User.google_sub == sub))
    assert len(result.scalars().all()) == 1


# --- /auth/youtube/login/user ------------------------------------------------


def test_user_login_requests_members_scope(client):
    from urllib.parse import parse_qs, urlparse

    from backend.auth.youtube import YOUTUBE_MEMBERS_SCOPE

    r = client.get("/auth/youtube/login/user?redirect=dashboard", follow_redirects=False)
    assert r.status_code in (302, 303, 307)
    qs = parse_qs(urlparse(r.headers["location"]).query)
    scopes = set(qs["scope"][0].split())
    assert YOUTUBE_MEMBERS_SCOPE in scopes
    assert "openid" in scopes and "email" in scopes and "profile" in scopes
    # state carries the dashboard redirect so the callback returns to the SPA.
    assert qs.get("state") == ["redirect=dashboard"]