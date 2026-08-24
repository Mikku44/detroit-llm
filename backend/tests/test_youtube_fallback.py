import json

from backend.auth.session import create_session_token


def test_extract_member_ids_from_members_response():
    from backend.auth.youtube import _extract_member_ids_from_payload

    payload = {
        "items": [
            {"snippet": {"memberDetails": {"channelId": "UCaaaa"}}},
            {"snippet": {"memberDetails": {"channelId": "UCbbbb"}}},
            {"snippet": {}},
        ],
        "nextPageToken": "x",
    }
    assert _extract_member_ids_from_payload(payload) == {"UCaaaa", "UCbbbb"}


def test_extract_member_ids_from_plain_list():
    from backend.auth.youtube import _extract_member_ids_from_payload

    assert _extract_member_ids_from_payload(["UCaaa", "UCbbb", "garbage"]) == {"UCaaa", "UCbbb"}
    assert _extract_member_ids_from_payload({"channel_ids": ["UCx", "UCy"]}) == {"UCx", "UCy"}


def test_extract_level_tiers_from_levels_response():
    from backend.auth.youtube import _extract_level_tiers_from_payload

    payload = {
        "items": [
            {"id": "CKDtrd6pg9bzVA", "snippet": {"levelDetails": {"displayName": "Nomad"}}},
            {"id": "CNPc-qPbk7zanQE", "snippet": {"levelDetails": {"displayName": "Dreamer"}}},
            {"id": "CJfPiPrfzbSl-wE", "snippet": {"levelDetails": {"displayName": "Angel investor"}}},
        ]
    }
    levels = _extract_level_tiers_from_payload(payload)
    assert levels == {
        "CKDtrd6pg9bzVA": "nomad",
        "CNPc-qPbk7zanQE": "dreamer",
        "CJfPiPrfzbSl-wE": "angel",
    }


def test_tier_id_from_level_id_uses_map():
    from backend.auth.youtube import _tier_id_from_level_id

    levels = {"CKDtrd6pg9bzVA": "nomad", "CNPc-qPbk7zanQE": "dreamer"}
    assert _tier_id_from_level_id("CKDtrd6pg9bzVA", levels) == "nomad"
    assert _tier_id_from_level_id("CNPc-qPbk7zanQE", levels) == "dreamer"
    # Unknown level -> default nomad.
    assert _tier_id_from_level_id("UNKNOWN", levels) == "nomad"
    assert _tier_id_from_level_id("", levels) == "nomad"


def test_members_requires_owner(client, non_member_user_id):
    token = create_session_token(non_member_user_id)
    r = client.get("/auth/youtube/members", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403

    r = client.post("/auth/youtube/members", json=[], headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403

    r = client.delete("/auth/youtube/members", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_set_and_get_members(client, owner_user_id, monkeypatch, tmp_path):
    import backend.auth.youtube as yt

    members_file = tmp_path / "members.json"
    monkeypatch.setattr(yt, "_members_json_path", lambda: str(members_file))

    token = create_session_token(owner_user_id)
    headers = {"Authorization": f"Bearer {token}"}

    # Reject empty payload.
    r = client.post("/auth/youtube/members", json=[], headers=headers)
    assert r.status_code == 400

    # Set a plain list.
    r = client.post(
        "/auth/youtube/members",
        json=["UCmember1", "UCmember2"],
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total_members"] == 2
    assert set(body["channel_ids"]) == {"UCmember1", "UCmember2"}

    # Get returns what we stored.
    r = client.get("/auth/youtube/members", headers=headers)
    assert r.status_code == 200
    assert r.json()["total_members"] == 2

    # Set a raw members.list response.
    raw = {
        "items": [
            {"snippet": {"memberDetails": {"channelId": "UCraw1"}}},
            {"snippet": {"memberDetails": {"channelId": "UCraw2"}}},
        ]
    }
    r = client.post("/auth/youtube/members", json=raw, headers=headers)
    assert r.status_code == 200
    assert set(r.json()["channel_ids"]) == {"UCraw1", "UCraw2"}

    # Clear.
    r = client.delete("/auth/youtube/members", headers=headers)
    assert r.status_code == 200
    assert r.json()["total_members"] == 0


def test_membership_fallback_grants_access(client, non_member_user_id, monkeypatch, tmp_path):
    """A user whose channel ID is in the stored list becomes a member."""
    import backend.auth.youtube as yt

    members_file = tmp_path / "members.json"
    monkeypatch.setattr(yt, "_members_json_path", lambda: str(members_file))
    yt._save_stored_member_ids({"UCfreeuser", "UCsomeother"})

    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    import asyncio

    async def set_channel():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            user.youtube_channel_id = "UCfreeuser"
            await db.commit()

    asyncio.run(set_channel())

    # is_youtube_member should match against the stored list (no owner token).
    import httpx

    async def check():
        async with httpx.AsyncClient() as client:
            return await yt._is_youtube_member(client, "UCfreeuser")

    assert asyncio.run(check()) is True

    async def check_other():
        async with httpx.AsyncClient() as client:
            return await yt._is_youtube_member(client, "UCnotamember")

    assert asyncio.run(check_other()) is False
