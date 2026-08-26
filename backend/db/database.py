from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

import logging

from backend.config import settings

logger = logging.getLogger("uvicorn.error")


def _is_postgres(url: str) -> bool:
    return url.startswith("postgresql")


def _make_engine(url: str):
    if _is_postgres(url):
        is_neon = "neon.tech" in url or "pooler" in url
        return create_async_engine(
            url,
            echo=False,
            pool_pre_ping=True,
            pool_size=5 if is_neon else 10,
            max_overflow=10 if is_neon else 20,
            pool_recycle=300,
            pool_timeout=30,
            connect_args={"prepared_statement_cache_size": 0} if is_neon else {},
        )
    return create_async_engine(url, echo=False)


def _set_sqlite_pragma(engine, url):
    if not url.startswith("sqlite"):
        return

    @event.listens_for(engine.sync_engine, "connect")
    def _listener(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


# Gateway DB: users, api keys, usage logs.
engine = _make_engine(settings.database_url)
_set_sqlite_pragma(engine, settings.database_url)

# Conversations DB: chat conversations + messages, kept separate so history
# scales independently of auth/usage data.
conversations_engine = _make_engine(settings.conversations_db_url)
_set_sqlite_pragma(conversations_engine, settings.conversations_db_url)

async_session = async_sessionmaker(engine, expire_on_commit=False)
conversations_async_session = async_sessionmaker(conversations_engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class ConversationBase(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_conversation_db() -> AsyncSession:
    async with conversations_async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def _sqlite_alter(conn, column_defs: tuple[str, ...]) -> None:
    """Best-effort column adds for SQLite (older databases missing columns)."""
    for column_def in column_defs:
        try:
            await conn.execute(text(column_def))
        except Exception:
            pass


async def _postgres_alter(conn, columns: tuple[tuple[str, str], ...]) -> None:
    """Add columns to Postgres only if they don't exist."""
    for name, col_type in columns:
        try:
            await conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN {0} {1}".format(name, col_type)
                    + " IF NOT EXISTS"
                )
            )
        except Exception:
            # Postgres supports ADD COLUMN IF NOT EXISTS, but keep this tolerant.
            pass


async def init_db():
    async with engine.begin() as conn:
        from backend.db.models import (
            User,
            ApiKey,
            UsageLog,
            ImageUsage,
            Payment,
            ChannelMember,
            MemberLevel,
        )
        await conn.run_sync(Base.metadata.create_all)

        # Index for the daily usage-log housekeeping job (cleanup_usage.py).
        try:
            await conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_usage_logs_created_at ON usage_logs (created_at)")
            )
        except Exception:
            logger.warning("Failed to create ix_usage_logs_created_at", exc_info=True)

        if settings.database_url.startswith("sqlite"):
            try:
                await conn.execute(text("ALTER TABLE api_keys ADD COLUMN raw_key VARCHAR"))
            except Exception:
                pass
            await _sqlite_alter(
                conn,
                (
                    "ALTER TABLE users ADD COLUMN is_paid BOOLEAN",
                    "ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR",
                    "ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR",
                    "ALTER TABLE users ADD COLUMN tier_id VARCHAR",
                    "ALTER TABLE users ADD COLUMN is_verified BOOLEAN",
                    "ALTER TABLE users ADD COLUMN phone_number VARCHAR",
                ),
            )
        else:
            await _postgres_alter(
                conn,
                (
                    ("is_paid", "BOOLEAN"),
                    ("stripe_customer_id", "VARCHAR"),
                    ("stripe_subscription_id", "VARCHAR"),
                    ("tier_id", "VARCHAR"),
                    ("is_verified", "BOOLEAN"),
                    ("phone_number", "VARCHAR"),
                ),
            )

    async with conversations_engine.begin() as conn:
        from backend.db.models import Conversation, ConversationMessage
        await conn.run_sync(ConversationBase.metadata.create_all)
        if settings.conversations_db_url.startswith("sqlite"):
            for column_def in (
                "ALTER TABLE conversation_messages ADD COLUMN finish_reason VARCHAR",
                "ALTER TABLE conversation_messages ADD COLUMN duration_ms INTEGER",
                "ALTER TABLE conversation_messages ADD COLUMN encrypted BOOLEAN",
            ):
                try:
                    await conn.execute(text(column_def))
                except Exception:
                    pass
        else:
            # Postgres: ensure columns exist if the table was created earlier.
            try:
                cols = {
                    r["column_name"]
                    for r in (
                        await conn.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_name = 'conversation_messages'"
                            )
                        )
                    ).fetchall()
                }
                for name, col_type in (
                    ("finish_reason", "VARCHAR"),
                    ("duration_ms", "INTEGER"),
                    ("encrypted", "BOOLEAN"),
                ):
                    if name not in cols:
                        try:
                            await conn.execute(
                                text(
                                    f"ALTER TABLE conversation_messages ADD COLUMN {name} {col_type}"
                                )
                            )
                        except Exception:
                            pass
            except Exception:
                pass
