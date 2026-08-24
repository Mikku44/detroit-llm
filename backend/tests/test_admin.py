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


def test_verify_members_owner_reaches_handler(client, owner_user_id, monkeypatch, tmp_path):
    token = create_session_token(owner_user_id)
    # Owner passes the gate; without OWNER_REFRESH_TOKEN the handler falls back
    # to the stored member list. Point it at an empty temp file so the result
    # is deterministic (0 members).
    import backend.auth.youtube as yt

    monkeypatch.setattr(yt, "_members_json_path", lambda: str(tmp_path / "members.json"))
    r = client.post(
        "/auth/youtube/verify-members",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["total_members"] == 0


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


def test_create_key_with_tz_aware_expiry(client, session_token):
    """A timezone-aware expires_at must be stored as naive UTC (Postgres compat)."""
    r = client.post(
        "/admin/keys",
        json={"name": "tz", "expires_at": "2026-09-22T14:37:35.669000+00:00"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expires_at"] is not None
    # Returned value should not carry a tz offset (naive UTC serialization).
    assert "+00:00" not in body["expires_at"]


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


def test_usage_limits_free_user(client, non_member_user_id):
    """Free users get weekly/monthly limits; the tier table is included."""
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    body = client.get(
        "/admin/usage/limits",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert body["plan"] == "free"
    assert body["is_free"] is True
    assert body["current_tier_id"] == "free"
    assert body["weekly_limit"] == 100000
    assert body["monthly_limit"] == 435000
    assert body["weekly_used"] == 0
    assert body["monthly_used"] == 0
    assert [t["id"] for t in body["tiers"]] == ["free", "nomad", "dreamer", "entrepreneur", "angel"]


def test_usage_limits_member_unlimited(client, owner_user_id):
    """Member/owner tiers have no weekly/monthly cap."""
    from backend.auth.session import create_session_token

    token = create_session_token(owner_user_id)
    body = client.get(
        "/admin/usage/limits",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert body["plan"] in ("member", "owner")
    assert body["is_free"] is False
    assert body["weekly_limit"] is None
    assert body["monthly_limit"] is None


def test_balances_non_owner_rejected(client, non_member_user_id):
    """Only owners may read the provider balances endpoint."""
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.get("/admin/balances", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "Owner access required" in r.json()["detail"]


def test_balances_owner_returns_providers(client, owner_user_id):
    """Owners get a per-provider result map, never a 500 even if checks fail."""
    from backend.auth.session import create_session_token

    token = create_session_token(owner_user_id)
    r = client.get("/admin/balances", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    for name in ("deepseek", "openrouter", "dashscope", "gemini", "sglang", "stripe"):
        assert name in body["providers"], name
        entry = body["providers"][name]
        assert entry["provider"] == name
        assert "configured" in entry
        assert "status" in entry
        assert "balance" in entry
        assert "error" in entry


def test_status_non_owner_rejected(client, non_member_user_id):
    """Only owners may read the gateway status endpoint."""
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.get("/admin/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "Owner access required" in r.json()["detail"]


def test_status_owner_reports_health_and_balance(client, owner_user_id):
    """Owners get upstream health, usage balance, user and key counts."""
    from backend.auth.session import create_session_token

    token = create_session_token(owner_user_id)
    r = client.get("/admin/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["health"]["providers"]["deepseek_configured"] is False
    assert body["balance"]["today"]["tokens"] >= 0
    assert body["users"]["total"] >= 1
    assert body["users"]["owners"] >= 1
    assert "free_tier" in body["balance"]
    assert body["api_keys"]["total"] >= 0


def test_set_user_verified_requires_owner(client, non_member_user_id):
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.post(
        f"/admin/users/{non_member_user_id}/verify",
        json={"is_verified": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_set_user_verified_owner_can_toggle(client, owner_user_id, non_member_user_id):
    """Owner can set/clear a user's is_verified flag; /admin/me reflects it."""
    from backend.auth.session import create_session_token

    owner_token = create_session_token(owner_user_id)
    r = client.post(
        f"/admin/users/{non_member_user_id}/verify",
        json={"is_verified": True},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 200
    assert r.json()["is_verified"] is True

    r = client.post(
        f"/admin/users/{non_member_user_id}/verify",
        json={"is_verified": False},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 200
    assert r.json()["is_verified"] is False


def test_set_user_verified_missing_user_404(client, owner_user_id):
    from backend.auth.session import create_session_token

    owner_token = create_session_token(owner_user_id)
    r = client.post(
        "/admin/users/does-not-exist/verify",
        json={"is_verified": True},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 404


def test_verify_phone_saves_number(client, non_member_user_id):
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    headers = {"Authorization": f"Bearer {token}"}

    # Missing phone -> 400.
    r = client.post("/admin/me/phone", json={}, headers=headers)
    assert r.status_code == 400

    # Valid phone -> saved + is_verified True.
    r = client.post(
        "/admin/me/phone",
        json={"phone_number": "+66812345678"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["phone_number"] == "+66812345678"
    assert r.json()["is_verified"] is True

    # /admin/me reflects it.
    me = client.get("/admin/me", headers=headers).json()
    assert me["phone_number"] == "+66812345678"
    assert me["is_verified"] is True


def test_payments_empty_for_fresh_user(client, non_member_user_id):
    from backend.auth.session import create_session_token

    token = create_session_token(non_member_user_id)
    r = client.get("/admin/payments", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["payments"] == []


def test_payments_lists_recorded_payments(client, non_member_user_id):
    from backend.auth.session import create_session_token
    from backend.db.database import async_session
    from backend.db.models import Payment

    import asyncio

    async def add_payment():
        async with async_session() as db:
            db.add(
                Payment(
                    user_id=non_member_user_id,
                    tier_id="nomad",
                    amount=5000,
                    currency="thb",
                    status="paid",
                    checkout_session_id="cs_test_1",
                    stripe_subscription_id="sub_1",
                )
            )
            await db.commit()

    asyncio.run(add_payment())

    token = create_session_token(non_member_user_id)
    r = client.get("/admin/payments", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    payments = r.json()["payments"]
    assert len(payments) == 1
    assert payments[0]["tier_id"] == "nomad"
    assert payments[0]["amount"] == 5000
    assert payments[0]["status"] == "paid"
