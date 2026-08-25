import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from backend.db.models import ApiKey, ImageUsage, UsageLog, User
from backend.scripts.cleanup_usage import purge_older_than


@pytest.mark.asyncio
async def test_purge_older_than_deletes_only_expired(client, db_session):
    uid = str(uuid.uuid4())
    key_id = str(uuid.uuid4())
    db_session.add(User(id=uid, google_email=f"cleanup-{uid}@test.local", is_member=False))
    db_session.add(ApiKey(id=key_id, key_prefix="sk-dt-test", key_hash="x", user_id=uid))
    await db_session.commit()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add_all(
        [
            # Expired: outside the 35-day retention.
            UsageLog(api_key_id=key_id, model="deepseek-v4-flash", total_tokens=1, created_at=now - timedelta(days=60)),
            # Kept: inside the retention (and inside the 30-day monthly window).
            UsageLog(api_key_id=key_id, model="deepseek-v4-flash", total_tokens=1, created_at=now - timedelta(days=5)),
            ImageUsage(user_id=uid, model="dall-e-3", created_at=now - timedelta(days=60)),
            ImageUsage(user_id=uid, model="dall-e-3", created_at=now - timedelta(days=5)),
        ]
    )
    await db_session.commit()

    result = await purge_older_than(db_session, now - timedelta(days=30))

    assert result == {"usage_logs": 1, "image_usage": 1}
    usage_left = (
        await db_session.execute(select(func.count(UsageLog.id)).where(UsageLog.api_key_id == key_id))
    ).scalar_one()
    image_left = (
        await db_session.execute(select(func.count(ImageUsage.id)).where(ImageUsage.user_id == uid))
    ).scalar_one()
    assert usage_left == 1
    assert image_left == 1


@pytest.mark.asyncio
async def test_purge_older_than_noop_when_nothing_expired(client, db_session):
    uid = str(uuid.uuid4())
    key_id = str(uuid.uuid4())
    db_session.add(User(id=uid, google_email=f"cleanup2-{uid}@test.local", is_member=False))
    db_session.add(ApiKey(id=key_id, key_prefix="sk-dt-test", key_hash="x", user_id=uid))
    await db_session.commit()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(
        UsageLog(api_key_id=key_id, model="deepseek-v4-flash", total_tokens=1, created_at=now - timedelta(days=1))
    )
    await db_session.commit()

    result = await purge_older_than(db_session, now - timedelta(days=30))
    assert result == {"usage_logs": 0, "image_usage": 0}
