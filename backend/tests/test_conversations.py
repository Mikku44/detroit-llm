import pytest


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