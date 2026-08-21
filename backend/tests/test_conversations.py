import pytest
import uuid
from sqlalchemy import select


def test_conversations_require_session(client):
    r = client.get("/api/conversations")
    assert r.status_code == 401


def test_conversations_crud(client, session_token, test_session_factory):
    headers = {"Authorization": f"Bearer {session_token}"}

    # Initially empty
    r = client.get("/api/conversations", headers=headers)
    assert r.status_code == 200
    assert r.json()["conversations"] == []

    # Create with messages
    r = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "My Chat",
            "model": "deepseek-v4-flash",
            "messages": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi there", "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
            ],
        },
    )
    assert r.status_code == 201
    conv_id = r.json()["id"]

    # List now has it
    r = client.get("/api/conversations", headers=headers)
    convs = r.json()["conversations"]
    assert len(convs) == 1
    assert convs[0]["id"] == conv_id

    # Get detail with messages
    r = client.get(f"/api/conversations/{conv_id}", headers=headers)
    data = r.json()
    assert data["title"] == "My Chat"
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][1]["content"] == "hi there"
    assert data["messages"][1]["usage"]["completion_tokens"] == 2

    # Update messages + title
    r = client.put(
        f"/api/conversations/{conv_id}",
        headers=headers,
        json={
            "title": "Renamed",
            "messages": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi there"},
                {"role": "user", "content": "again"},
            ],
        },
    )
    assert r.status_code == 200
    r = client.get(f"/api/conversations/{conv_id}", headers=headers)
    assert r.json()["title"] == "Renamed"
    assert len(r.json()["messages"]) == 3
    assert r.json()["messages"][2]["content"] == "again"

    # User cannot access another user's conversation
    other_token = create_other_session()
    r = client.get(
        f"/api/conversations/{conv_id}", headers={"Authorization": f"Bearer {other_token}"}
    )
    assert r.status_code == 404
    r = client.delete(
        f"/api/conversations/{conv_id}", headers={"Authorization": f"Bearer {other_token}"}
    )
    assert r.status_code == 404

    # Delete
    r = client.delete(f"/api/conversations/{conv_id}", headers=headers)
    assert r.status_code == 200
    r = client.get("/api/conversations", headers=headers)
    assert r.json()["conversations"] == []


def test_conversation_not_found(client, session_token):
    headers = {"Authorization": f"Bearer {session_token}"}
    assert client.get("/api/conversations/nope", headers=headers).status_code == 404
    assert client.put("/api/conversations/nope", headers=headers, json={}).status_code == 404
    assert client.delete("/api/conversations/nope", headers=headers).status_code == 404


def create_other_session():
    import uuid
    from backend.auth.session import create_session_token

    return create_session_token(str(uuid.uuid4()))


@pytest.fixture(autouse=True)
def _ensure_user_exists(client, session_token, test_session_factory):
    """session_token maps to a random user with no DB row; create one so FK works."""
    import jwt as pyjwt
    from backend.config import settings
    from backend.db.models import User

    payload = pyjwt.decode(session_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    user_id = payload["sub"]
    import asyncio

    async def _run():
        async with test_session_factory() as session:
            exists = await session.get(User, user_id)
            if not exists:
                session.add(User(id=user_id, google_email=f"conv-{user_id}@test.local", is_member=True))
                await session.commit()

    asyncio.run(_run())
    yield


def _create_session_for(user_id):
    import uuid
    from backend.auth.session import create_session_token

    return create_session_token(user_id)


def test_paid_user_messages_encrypted_at_rest(client, test_session_factory, conv_session_factory):
    """Paid users' message content must be encrypted in the conversations DB but
    readable back through the API."""
    from backend.db.models import Conversation, ConversationMessage, User

    import asyncio

    user_id = str(uuid.uuid4())
    token = _create_session_for(user_id)

    async def _seed():
        async with test_session_factory() as s:
            s.add(User(id=user_id, google_email=f"paid-{user_id}@test.local", is_member=True))
            await s.commit()

    asyncio.run(_seed())

    headers = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "Secret plan",
            "model": "deepseek-v4-flash",
            "messages": [
                {"role": "user", "content": "my secret password is hunter2"},
                {"role": "assistant", "content": "got it", "reasoning": "internal reasoning"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    conv_id = r.json()["id"]

    async def _inspect():
        async with conv_session_factory() as s:
            msgs = await s.execute(
                select(ConversationMessage)
                .where(ConversationMessage.conversation_id == conv_id)
                .order_by(ConversationMessage.position)
            )
            return [(m.encrypted, m.content, m.reasoning) for m in msgs.scalars().all()]

    rows = asyncio.run(_inspect())
    assert len(rows) == 2
    for encrypted, content, reasoning in rows:
        assert encrypted is True
        assert "hunter2" not in content
        assert "internal reasoning" not in (reasoning or "")
        assert "my secret password" not in content

    r = client.get(f"/api/conversations/{conv_id}", headers=headers)
    data = r.json()
    assert data["messages"][0]["content"] == "my secret password is hunter2"
    assert data["messages"][1]["reasoning"] == "internal reasoning"


def test_free_user_messages_plaintext_at_rest(client, test_session_factory, conv_session_factory):
    """Free users' messages stay plaintext and are still readable."""
    from backend.db.models import Conversation, ConversationMessage, User

    import asyncio

    user_id = str(uuid.uuid4())
    token = _create_session_for(user_id)

    async def _seed():
        async with test_session_factory() as s:
            s.add(User(id=user_id, google_email=f"free-{user_id}@test.local", is_member=False))
            await s.commit()

    asyncio.run(_seed())

    headers = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "Free chat",
            "messages": [{"role": "user", "content": "plain hello"}],
        },
    )
    assert r.status_code == 201, r.text
    conv_id = r.json()["id"]

    async def _inspect():
        async with conv_session_factory() as s:
            conv = await s.get(Conversation, conv_id)
            msgs = await s.execute(
                select(ConversationMessage).where(ConversationMessage.conversation_id == conv_id)
            )
            return [(m.encrypted, m.content) for m in msgs.scalars().all()]

    rows = asyncio.run(_inspect())
    assert rows == [(False, "plain hello")]

    r = client.get(f"/api/conversations/{conv_id}", headers=headers)
    assert r.json()["messages"][0]["content"] == "plain hello"