from backend.auth.api_keys import generate_api_key
from backend.auth.middleware import extract_key_prefix


def test_extract_key_prefix_valid():
    raw, prefix, _ = generate_api_key()
    assert extract_key_prefix(raw) == prefix


def test_extract_key_prefix_invalid():
    assert extract_key_prefix("no-prefix-here") is None
    assert extract_key_prefix("sk-dt-short") is None
    assert extract_key_prefix("") is None


def test_missing_auth_header_returns_401(client):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 401
    assert "Missing or invalid Authorization" in r.json()["detail"]


def test_invalid_key_format_returns_401(client):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": "Bearer not-a-valid-key"},
    )
    assert r.status_code == 401


def test_valid_key_returns_mock_chat(client, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["object"] == "chat.completion"
    assert data["choices"][0]["message"]["content"]


def test_revoked_key_returns_401(client, session_token):
    from backend.auth.session import create_session_token

    token = create_session_token("revoke-test-user")

    r = client.post(
        "/admin/keys",
        json={"name": "temp"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    raw_key = r.json()["key"]

    keys = client.get("/admin/keys", headers={"Authorization": f"Bearer {token}"}).json()["keys"]
    key_id = keys[0]["id"]
    client.delete(f"/admin/keys/{key_id}", headers={"Authorization": f"Bearer {token}"})

    r2 = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    assert r2.status_code == 401
