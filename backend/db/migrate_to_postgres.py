"""One-time migration: copy gateway.db + conversations.db (SQLite) into PostgreSQL.

Run from the repo root AFTER setting Postgres URLs in backend/.env:

    DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname
    CONVERSATIONS_DB_URL=postgresql+asyncpg://user:pass@host:5432/dbname_conversations

    python -m backend.db.migrate_to_postgres

Safe to re-run: skips rows whose primary key already exists in the target.
"""

import asyncio
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from backend.db.database import engine, conversations_engine, async_session, conversations_async_session
from backend.db.models import User, ApiKey, UsageLog, ImageUsage, Conversation, ConversationMessage
from backend.db.database import _is_postgres


def _sqlite_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _dt(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


async def _copy_rows(session, model, rows, columns, skip_check_col):
    """Insert rows, skipping ones whose pk already exists."""
    existing = set((await session.execute(select(getattr(model, skip_check_col)))).scalars().all())
    added = 0
    for row in rows:
        pk = row[skip_check_col]
        if pk in existing:
            continue
        kwargs = {c: (_dt(v) if c.endswith("_at") and isinstance(v, str) else v) for c, v in zip(columns, row)}
        session.add(model(**kwargs))
        added += 1
    await session.commit()
    return added


async def migrate_gateway(gateway_db: Path):
    conn = _sqlite_conn(gateway_db)

    async with engine.begin() as c:
        await c.run_sync(User.__table__.create, checkfirst=True)
        await c.run_sync(ApiKey.__table__.create, checkfirst=True)
        await c.run_sync(UsageLog.__table__.create, checkfirst=True)
        await c.run_sync(ImageUsage.__table__.create, checkfirst=True)

    async with async_session() as session:
        users = conn.execute("SELECT * FROM users").fetchall()
        added_u = await _copy_rows(session, User, users, users[0].keys() if users else (), "id")

        # Insert keys only for users that actually exist (skip orphans whose
        # user was deleted from the source DB — e.g. old test accounts).
        keys = conn.execute("SELECT * FROM api_keys").fetchall()
        key_cols = keys[0].keys() if keys else ()
        user_ids = {u[0] for u in users}
        valid_keys = [k for k in keys if k["user_id"] in user_ids]
        added_k = await _copy_rows(session, ApiKey, valid_keys, key_cols, "id")

        logs = conn.execute("SELECT * FROM usage_logs").fetchall()
        log_cols = logs[0].keys() if logs else ()
        key_ids = {k["id"] for k in valid_keys}
        valid_logs = [l for l in logs if l["api_key_id"] in key_ids]
        added_l = await _copy_rows(session, UsageLog, valid_logs, log_cols, "id")

        images = []
        try:
            images = conn.execute("SELECT * FROM image_usage").fetchall()
        except Exception:
            pass
        image_cols = images[0].keys() if images else ()
        valid_images = [i for i in images if i["user_id"] in user_ids]
        added_i = await _copy_rows(session, ImageUsage, valid_images, image_cols, "id")

    conn.close()
    print(
        f"gateway: +{added_u} users, +{added_k} keys (skipped {len(keys) - len(valid_keys)} orphan), "
        f"+{added_l} usage (skipped {len(logs) - len(valid_logs)} orphan), +{added_i} images"
    )


async def migrate_conversations(conv_db: Path):
    conn = _sqlite_conn(conv_db)

    async with conversations_engine.begin() as c:
        await c.run_sync(Conversation.__table__.create, checkfirst=True)
        await c.run_sync(ConversationMessage.__table__.create, checkfirst=True)

    async with conversations_async_session() as session:
        convs = conn.execute("SELECT * FROM conversations").fetchall()
        conv_cols = convs[0].keys() if convs else ()
        added_c = await _copy_rows(session, Conversation, convs, conv_cols, "id")

        msgs = conn.execute("SELECT * FROM conversation_messages").fetchall()
        msg_cols = msgs[0].keys() if msgs else ()
        conv_ids = {c[0] for c in convs}
        valid_msgs = [m for m in msgs if m["conversation_id"] in conv_ids]
        added_m = await _copy_rows(session, ConversationMessage, valid_msgs, msg_cols, "id")

    conn.close()
    print(
        f"conversations: +{added_c} conversations, "
        f"+{added_m} messages (skipped {len(msgs) - len(valid_msgs)} orphan)"
    )


async def main():
    if not _is_postgres(settings_database_url()):
        print(
            "DATABASE_URL is not PostgreSQL. Set it (postgresql+asyncpg://...) "
            "in backend/.env before migrating."
        )
        return

    gateway_db = Path(os.environ.get("GATEWAY_DB", "gateway.db"))
    conv_db = Path(os.environ.get("CONVERSATIONS_DB", "conversations.db"))

    if not gateway_db.exists():
        print(f"gateway.db not found at {gateway_db}")
    else:
        await migrate_gateway(gateway_db)

    if not conv_db.exists():
        print(f"conversations.db not found at {conv_db}")
    else:
        await migrate_conversations(conv_db)

    print("Migration complete.")


def settings_database_url() -> str:
    from backend.config import settings
    return settings.database_url


if __name__ == "__main__":
    asyncio.run(main())
