from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings


engine = create_async_engine(settings.database_url, echo=False)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    if settings.database_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        from backend.db.models import User, ApiKey, UsageLog, Conversation, ConversationMessage
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        try:
            await conn.execute(text("ALTER TABLE api_keys ADD COLUMN raw_key VARCHAR"))
        except Exception:
            pass
        # Lightweight migrations for conversation tables created before these columns.
        for column_def in (
            "ALTER TABLE conversation_messages ADD COLUMN finish_reason VARCHAR",
            "ALTER TABLE conversation_messages ADD COLUMN duration_ms INTEGER",
        ):
            try:
                await conn.execute(text(column_def))
            except Exception:
                pass
