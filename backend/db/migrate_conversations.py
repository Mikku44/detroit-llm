"""One-time migration: copy conversations from gateway.db into conversations.db.

Run from the repo root:
    python -m backend.db.migrate_conversations

Safe to re-run: it skips conversations whose id already exists in the target.
"""

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, func, text

from backend.db.database import conversations_engine, conversations_async_session
from backend.db.models import Conversation, ConversationMessage


def _gateway_conn(gateway_db: Path):
    import sqlite3

    return sqlite3.connect(str(gateway_db))


def _dt(value):
    """Parse an ISO timestamp string from sqlite back into a datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


async def _target_exists(session, table: str) -> int:
    result = await session.execute(text(f"SELECT count(*) FROM {table}"))
    return int(result.scalar_one())


async def main():
    gateway_db = Path(os.environ.get("GATEWAY_DB", "gateway.db"))
    if not gateway_db.exists():
        print(f"gateway.db not found at {gateway_db}. Nothing to migrate.")
        return

    conn = _gateway_conn(gateway_db)
    convs = conn.execute(
        "SELECT id, user_id, title, model, created_at, updated_at FROM conversations"
    ).fetchall()
    msgs = conn.execute(
        "SELECT id, conversation_id, role, content, reasoning, model, usage, attachments, "
        "finish_reason, duration_ms, position, created_at FROM conversation_messages"
    ).fetchall()
    conn.close()

    if not convs:
        print("No conversations found in gateway.db. Nothing to migrate.")
        return

    async with conversations_engine.begin() as conn:
        await conn.run_sync(Conversation.__table__.create, checkfirst=True)
        await conn.run_sync(ConversationMessage.__table__.create, checkfirst=True)

    async with conversations_async_session() as session:
        existing = set((await session.execute(select(Conversation.id))).scalars().all())

        new_convs = [c for c in convs if c[0] not in existing]
        for row in new_convs:
            session.add(
                Conversation(
                    id=row[0],
                    user_id=row[1],
                    title=row[2] or "New Chat",
                    model=row[3],
                    created_at=_dt(row[4]),
                    updated_at=_dt(row[5]),
                )
            )
        await session.commit()

        for row in msgs:
            if row[1] not in existing:
                session.add(
                    ConversationMessage(
                        id=row[0],
                        conversation_id=row[1],
                        role=row[2],
                        content=row[3] or "",
                        reasoning=row[4],
                        model=row[5],
                        usage=row[6],
                        attachments=row[7],
                        finish_reason=row[8],
                        duration_ms=row[9],
                        position=row[10],
                        created_at=_dt(row[11]),
                    )
                )
        await session.commit()

    print(f"Migrated {len(new_convs)} conversations and {sum(1 for m in msgs if m[1] not in existing)} messages.")


if __name__ == "__main__":
    asyncio.run(main())
