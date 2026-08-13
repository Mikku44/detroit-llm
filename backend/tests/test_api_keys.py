from backend.auth.api_keys import (
    generate_api_key,
    hash_api_key,
    verify_api_key,
    create_api_key_for_user,
    revoke_api_key,
    get_api_key_by_prefix,
)


def test_generate_api_key_format():
    raw, prefix, key_hash = generate_api_key()

    parts = raw.split("-")
    assert raw.startswith("sk-dt-")
    assert len(parts) == 4
    assert prefix == "-".join(parts[:3])
    assert key_hash == hash_api_key(raw)


def test_hash_api_key_is_deterministic():
    assert hash_api_key("sk-dt-abc-123") == hash_api_key("sk-dt-abc-123")
    assert hash_api_key("sk-dt-abc-123") != hash_api_key("sk-dt-abc-124")


def test_verify_api_key():
    raw, _, _ = generate_api_key()
    other_raw, _, _ = generate_api_key()

    assert verify_api_key(raw, hash_api_key(raw)) is True
    assert verify_api_key(other_raw, hash_api_key(raw)) is False
    assert verify_api_key("", hash_api_key(raw)) is False


async def test_create_and_revoke_deletes_key(db_session):
    raw, entry = await create_api_key_for_user(db_session, "user-1", "dev", None)

    assert raw.startswith("sk-dt-")
    found = await get_api_key_by_prefix(db_session, entry.key_prefix)
    assert found is not None
    assert found.id == entry.id

    ok = await revoke_api_key(db_session, entry.id)
    assert ok is True

    assert await get_api_key_by_prefix(db_session, entry.key_prefix) is None


async def test_revoke_missing_key_returns_false(db_session):
    from backend.db.models import ApiKey

    ok = await revoke_api_key(db_session, "does-not-exist")
    assert ok is False
