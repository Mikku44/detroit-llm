import os
import tempfile
import uuid
from pathlib import Path

# Env must be set BEFORE any backend module is imported
_DB_FILE = Path(tempfile.mkdtemp()) / "test_gateway.db"
_CONV_DB_FILE = Path(tempfile.mkdtemp()) / "test_conversations.db"

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_FILE}"
os.environ["CONVERSATIONS_DB_URL"] = f"sqlite+aiosqlite:///{_CONV_DB_FILE}"
os.environ["JWT_SECRET"] = "test-jwt-secret-1234567890-abcdefghijklmnopqrstuvwxyz"
os.environ["RATE_LIMIT_PER_MINUTE"] = "3600"
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""
# Hermetic tests: never hit external image providers (Unsplash/loremflickr).
os.environ["IMAGE_PROVIDER"] = "mock"
os.environ["UNSPLASH_ACCESS_KEY"] = ""
# Keep tests hermetic: a local backend/.env may set real OAuth values.
os.environ["OWNER_REFRESH_TOKEN"] = ""
os.environ["OWNER_GOOGLE_EMAIL"] = ""
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from fastapi.testclient import TestClient

from backend.main import app
from backend.db.models import Base, ConversationBase
from backend.db.database import get_db, get_conversation_db
from backend.auth.session import create_session_token

TEST_DB_URL = os.environ["DATABASE_URL"]
TEST_CONV_DB_URL = os.environ["CONVERSATIONS_DB_URL"]
DB_FILE = _DB_FILE
CONV_DB_FILE = _CONV_DB_FILE


@pytest.fixture(scope="session")
def test_engine():
    engine = create_async_engine(TEST_DB_URL, poolclass=NullPool)
    yield engine
    import asyncio
    asyncio.run(engine.dispose())


@pytest.fixture(scope="session")
def test_session_factory(test_engine):
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(scope="session")
def conv_test_engine():
    from sqlalchemy.ext.asyncio import create_async_engine as _cae
    from sqlalchemy.pool import NullPool

    engine = _cae(TEST_CONV_DB_URL, poolclass=NullPool)
    yield engine
    import asyncio
    asyncio.run(engine.dispose())


@pytest.fixture(scope="session")
def conv_session_factory(conv_test_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker as _asm

    return _asm(conv_test_engine, expire_on_commit=False)


@pytest.fixture(scope="session")
def client(test_session_factory, conv_session_factory):
    from sqlalchemy import create_engine

    sync_engine = create_engine(f"sqlite:///{DB_FILE}")
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    conv_sync_engine = create_engine(f"sqlite:///{CONV_DB_FILE}")
    ConversationBase.metadata.create_all(conv_sync_engine)
    conv_sync_engine.dispose()

    async def _override_get_db():
        async with test_session_factory() as session:
            yield session

    async def _override_get_conversation_db():
        async with conv_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_conversation_db] = _override_get_conversation_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def db_session(test_session_factory):
    async with test_session_factory() as session:
        yield session


@pytest.fixture
def session_token():
    return create_session_token(str(uuid.uuid4()))


@pytest_asyncio.fixture
async def non_member_user_id(db_session):
    from backend.db.models import User

    user = User(
        id=str(uuid.uuid4()),
        google_email=f"free-{uuid.uuid4().hex}@test.local",
        is_member=False,
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


@pytest_asyncio.fixture
async def verified_free_user_id(db_session):
    """A free-tier user who has verified their phone (is_verified=True)."""
    from backend.db.models import User

    user = User(
        id=str(uuid.uuid4()),
        google_email=f"free-verified-{uuid.uuid4().hex}@test.local",
        is_member=False,
        is_verified=True,
        phone_number="+66812345678",
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


@pytest_asyncio.fixture
async def owner_user_id(db_session):
    from backend.db.models import User

    user = User(
        id=str(uuid.uuid4()),
        google_email=f"owner-{uuid.uuid4().hex}@test.local",
        is_owner=True,
        is_member=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


@pytest_asyncio.fixture
async def api_key(client, session_token, test_session_factory):
    import jwt as pyjwt

    from backend.config import settings
    from backend.db.models import User

    payload = pyjwt.decode(session_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    user_id = payload["sub"]

    async with test_session_factory() as session:
        user = User(
            id=user_id,
            google_email=f"member-{user_id}@test.local",
            is_member=True,
        )
        session.add(user)
        await session.commit()

    r = client.post(
        "/admin/keys",
        json={"name": "test"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["key"]
