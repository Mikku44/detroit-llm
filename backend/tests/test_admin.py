from backend.auth.session import create_session_token


def test_verify_members_requires_auth(client):
    r = client.post("/auth/youtube/verify-members")
    assert r.status_code == 401


def test_verify_members_non_owner_rejected(client, non_member_user_id):
    token = create_session_token(non_member_user_id)
    r = client.post(
        "/auth/youtube/verify-members",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403
    assert "Owner access required" in r.json()["detail"]


def test_verify_members_owner_reaches_handler(client, owner_user_id):
    token = create_session_token(owner_user_id)
    # Owner passes the gate; without OWNER_REFRESH_TOKEN the handler 400s.
    r = client.post(
        "/auth/youtube/verify-members",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_me_without_token_returns_401(client):
    r = client.get("/admin/me")
    assert r.status_code == 401


def test_list_keys_empty_for_fresh_user(client, session_token):
    r = client.get("/admin/keys", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 200
    assert r.json()["keys"] == []


def test_create_key_returns_raw_key(client, session_token):
    r = client.post(
        "/admin/keys",
        json={"name": "dev"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["key"].startswith("sk-dt-")
    assert body["name"] == "dev"


def test_list_keys_includes_raw_key(client, session_token):
    created = client.post(
        "/admin/keys",
        json={"name": "dev"},
        headers={"Authorization": f"Bearer {session_token}"},
    ).json()

    keys = client.get("/admin/keys", headers={"Authorization": f"Bearer {session_token}"}).json()["keys"]
    assert len(keys) == 1
    assert keys[0]["key"] == created["key"]
    assert keys[0]["name"] == "dev"


def test_revoke_deletes_key(client, session_token):
    client.post(
        "/admin/keys",
        json={"name": "temp"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    keys = client.get("/admin/keys", headers={"Authorization": f"Bearer {session_token}"}).json()["keys"]
    key_id = keys[0]["id"]

    r = client.delete(f"/admin/keys/{key_id}", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 200

    keys_after = client.get("/admin/keys", headers={"Authorization": f"Bearer {session_token}"}).json()["keys"]
    assert keys_after == []


def test_usage_empty_for_fresh_user_returns_zero_filled_range(client, session_token):
    r = client.get("/admin/usage?days=7", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 200
    usage = r.json()["usage"]
    assert len(usage) == 7
    assert all(row["requests"] == 0 and row["total_tokens"] == 0 for row in usage)


def test_punchcard_empty_for_fresh_user(client, session_token):
    r = client.get(
        "/admin/usage/punchcard?days=7",
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["matrix"]) == 7
    assert all(len(row) == 24 for row in body["matrix"])
    assert body["max"] == 0


def test_punchcard_records_one_request(client, session_token, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200

    body = client.get(
        "/admin/usage/punchcard?days=7",
        headers={"Authorization": f"Bearer {session_token}"},
    ).json()
    assert len(body["matrix"]) == 7
    assert all(len(row) == 24 for row in body["matrix"])
    assert sum(sum(row) for row in body["matrix"]) == 1
    assert body["max"] == 1


def test_usage_models_records_one_request(client, session_token, api_key):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    assert r.status_code == 200

    body = client.get(
        "/admin/usage/models?days=7",
        headers={"Authorization": f"Bearer {session_token}"},
    ).json()
    assert len(body["models"]) == 1
    assert body["models"][0]["requests"] == 1
    assert body["models"][0]["model"]
    assert body["models"][0]["total_tokens"] > 0
