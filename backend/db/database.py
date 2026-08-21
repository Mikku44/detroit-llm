from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings


def _make_engine(url: str):
    return create_async_engine(url, echo=False)


def _set_sqlite_pragma(engine, url):
    @event.listens_for(engine.sync_engine, "connect")
    def _listener(dbapi_connection, connection_record):
        if url.startswith("sqlite"):
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


async def init_db():
    async with engine.begin() as conn:
        from backend.db.models import User, ApiKey, UsageLog
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        try:
            await conn.execute(text("ALTER TABLE api_keys ADD COLUMN raw_key VARCHAR"))
        except Exception:
            pass

    async with conversations_engine.begin() as conn:
        from backend.db.models import Conversation, ConversationMessage
        await conn.run_sync(ConversationBase.metadata.create_all)
        from sqlalchemy import text
        # Lightweight migrations for conversation tables created before these columns.
        for column_def in (
            "ALTER TABLE conversation_messages ADD COLUMN finish_reason VARCHAR",
            "ALTER TABLE conversation_messages ADD COLUMN duration_ms INTEGER",
            "ALTER TABLE conversation_messages ADD COLUMN encrypted BOOLEAN",
        ):
            try:
                await conn.execute(text(column_def))
            except Exception:
                pass
