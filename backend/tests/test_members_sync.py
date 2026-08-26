import pytest


@pytest.fixture(autouse=True)
def _clear_member_tables(client):
    """Wipe channel_members/member_levels before+after each test.

    These tests share the session-scoped test DB, and the member list now lives
    in the DB — leftover rows would leak into other test modules.
    """
    import asyncio
    import backend.auth.members as members

    asyncio.run(members._db_clear_members())
    yield
    asyncio.run(members._db_clear_members())


def test_fetch_member_ids_falls_back_to_stored(monkeypatch, tmp_path):
    """Without a refresh token, member IDs come from the stored JSON file."""
    import backend.auth.members as members

    members_file = tmp_path / "members.json"
    members_file.write_text(
        '{"channel_ids": ["UCaaa", "UCbbb"]}',
        encoding="utf-8",
    )

    monkeypatch.setattr(
        members, "_load_stored_member_ids",
        lambda: {"UCaaa", "UCbbb"},
    )
    monkeypatch.setattr(members, "settings", type("S", (), {"owner_refresh_token": ""})())
    # reset cache
    members._cache_loaded = False
    members._member_cache = set()

    ids = __import__("asyncio").run(members.fetch_member_ids())
    assert ids == {"UCaaa", "UCbbb"}


def test_is_member_channel_matches_stored(monkeypatch, tmp_path):
    import asyncio
    import backend.auth.members as members

    monkeypatch.setattr(members, "_load_stored_member_ids", lambda: {"UCmember1"})
    monkeypatch.setattr(members, "settings", type("S", (), {"owner_refresh_token": ""})())
    members._cache_loaded = False
    members._member_cache = set()

    assert asyncio.run(members.is_member_channel("UCmember1")) is True
    assert asyncio.run(members.is_member_channel("UCother")) is False
    assert asyncio.run(members.is_member_channel(None)) is False


def test_sync_all_users_updates_flags(client, monkeypatch, tmp_path):
    """sync_all_users sets is_member for users whose channel is on the list."""
    import asyncio
    from backend.auth.session import create_session_token
    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    import backend.auth.members as members

    monkeypatch.setattr(members, "_load_stored_member_ids", lambda: {"UCmember1"})
    monkeypatch.setattr(members, "settings", type("S", (), {"owner_refresh_token": ""})())
    members._cache_loaded = False
    members._member_cache = set()

    # Create two users: one whose channel is a member, one who is not.
    token = create_session_token("some-owner")
    r = client.post(
        "/admin/keys",
        json={"name": "owner"},
        headers={"Authorization": f"Bearer {token}"},
    )
    # key creation fails (no user) — that's fine; we just need DB users directly.
    assert r.status_code in (200, 404)

    async def seed():
        async with async_session() as db:
            db.add(User(id="u-member", google_email="m@t.local", youtube_channel_id="UCmember1"))
            db.add(User(id="u-non", google_email="n@t.local", youtube_channel_id="UCnotmember"))
            await db.commit()

    asyncio.run(seed())

    summary = asyncio.run(members.sync_all_users())

    async def check():
        async with async_session() as db:
            m = (await db.execute(select(User).where(User.id == "u-member"))).scalar_one()
            n = (await db.execute(select(User).where(User.id == "u-non"))).scalar_one()
            return m.is_member, n.is_member

    member_flag, non_flag = asyncio.run(check())
    assert member_flag is True
    assert non_flag is False
    assert summary["total_members"] == 1


def test_check_api_status_reports_403(client, session_token, monkeypatch):
    """When the YouTube API returns an error, status must report unavailable."""
    import backend.auth.members as members

    async def fake_check():
        return {
            "available": False,
            "reason": "api_error",
            "detail": "YouTube members API returned 403. Membership verification is unavailable.",
        }

    monkeypatch.setattr(members, "check_api_status", fake_check)

    r = client.get("/auth/youtube/status", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert body["reason"] == "api_error"


def test_db_save_and_load_members_roundtrip(client):
    """The member list is persisted to the channel_members table."""
    import asyncio
    import backend.auth.members as members

    asyncio.run(
        members._db_save_members(
            {"UCaaa", "UCbbb"},
            {"UCaaa": "nomad", "UCbbb": "dreamer"},
        )
    )

    async def check():
        tiers = await members._db_load_member_tiers()
        ids = set(tiers)
        return ids, tiers

    ids, tiers = asyncio.run(check())
    assert ids == {"UCaaa", "UCbbb"}
    assert tiers["UCaaa"] == "nomad"
    assert tiers["UCbbb"] == "dreamer"


def test_db_clear_members_removes_rows(client):
    import asyncio
    import backend.auth.members as members

    asyncio.run(members._db_save_members({"UCkeep"}))
    asyncio.run(members._db_clear_members())

    async def check():
        return set(await members._db_load_member_tiers())

    assert asyncio.run(check()) == set()


def test_db_save_level_tiers_roundtrip(client):
    import asyncio
    import backend.auth.members as members

    asyncio.run(members._db_save_level_tiers({"L1": "nomad", "L2": "angel"}))
    assert asyncio.run(members._db_load_level_tiers()) == {"L1": "nomad", "L2": "angel"}


def test_fetch_member_ids_warms_cache_from_db(client, monkeypatch):
    """With no refresh token, fetch_member_ids loads the list from the DB."""
    import asyncio
    import backend.auth.members as members

    asyncio.run(members._db_save_members({"UCdb1", "UCdb2"}, {"UCdb1": "nomad"}))
    monkeypatch.setattr(members, "settings", type("S", (), {"owner_refresh_token": ""})())
    members._cache_loaded = False
    members._member_cache = set()

    ids = asyncio.run(members.fetch_member_ids())
    assert ids == {"UCdb1", "UCdb2"}


def test_set_stored_members_persists_to_db(client, session_token, monkeypatch):
    """POST /auth/youtube/members writes the member list into the DB."""
    import asyncio
    from backend.auth.session import create_session_token
    from backend.db.database import async_session
    from backend.db.models import ChannelMember, User
    from sqlalchemy import select

    import backend.auth.members as members

    # Need an owner user whose session token maps to it.
    owner_id = "owner-db-test"
    token = create_session_token(owner_id)

    async def seed():
        async with async_session() as db:
            db.add(User(id=owner_id, google_email="owner-db@test.local", is_owner=True, is_member=True))
            await db.commit()

    asyncio.run(seed())

    r = client.post(
        "/auth/youtube/members",
        json={"channel_ids": ["UCx1", "UCx2"], "tiers": {"UCx1": "nomad", "UCx2": "angel"}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    async def check():
        async with async_session() as db:
            result = await db.execute(select(ChannelMember))
            return {m.channel_id: m.tier_id for m in result.scalars()}

    rows = asyncio.run(check())
    assert rows.get("UCx1") == "nomad"
    assert rows.get("UCx2") == "angel"


def test_check_api_status_reports_ok(client, session_token, monkeypatch):
    import backend.auth.members as members

    async def fake_check():
        return {"available": True, "reason": "ok", "member_count": 4, "detail": "working"}

    monkeypatch.setattr(members, "check_api_status", fake_check)

    r = client.get("/auth/youtube/status", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 200
    assert r.json()["available"] is True
    assert r.json()["member_count"] == 4
