import os
import tempfile
import uuid
from pathlib import Path

# Env must be set BEFORE any backend module is imported
_DB_FILE = Path(tempfile.mkdtemp()) / "test_gateway.db"

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_FILE}"
os.environ["JWT_SECRET"] = "test-jwt-secret-1234567890-abcdefghijklmnopqrstuvwxyz"
os.environ["RATE_LIMIT_PER_MINUTE"] = "3600"
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from fastapi.testclient import TestClient

from backend.main import app
from backend.db.models import Base
from backend.db.database import get_db
from backend.auth.session import create_session_token

TEST_DB_URL = os.environ["DATABASE_URL"]
DB_FILE = _DB_FILE


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
def client(test_session_factory):
    from sqlalchemy import create_engine

    sync_engine = create_engine(f"sqlite:///{DB_FILE}")
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    async def _override_get_db():
        async with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
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


@pytest.fixture
def api_key(client, session_token):
    r = client.post(
        "/admin/keys",
        json={"name": "test"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["key"]
