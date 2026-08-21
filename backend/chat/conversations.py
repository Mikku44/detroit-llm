import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth.session import require_session
from backend.db.database import get_conversation_db, get_db
from backend.db.models import Conversation, ConversationMessage, User
from backend.chat.crypto import chat_date_of, decrypt_text, derive_key, encrypt_text

router = APIRouter()


async def _user_is_paid(gw_db: AsyncSession, user_id: str) -> bool:
    user = await gw_db.get(User, user_id)
    return bool(user and (user.is_member or user.is_owner))


def _msg_to_dict(m: ConversationMessage, key: bytes | None = None) -> dict:
    """Serialize a ConversationMessage row back into a Chat3 Msg shape."""
    content = m.content or ""
    reasoning = m.reasoning
    if m.encrypted and key:
        content = decrypt_text(key, content)
        reasoning = decrypt_text(key, reasoning) if reasoning else None
    out: dict = {"role": m.role, "content": content}
    if reasoning:
        out["reasoning"] = reasoning
    if m.model:
        out["model"] = m.model
    if m.usage:
        try:
            out["usage"] = json.loads(m.usage)
        except json.JSONDecodeError:
            pass
    if m.attachments:
        try:
            out["attachments"] = json.loads(m.attachments)
        except json.JSONDecodeError:
            pass
    if m.finish_reason:
        out["finish_reason"] = m.finish_reason
    if m.duration_ms is not None:
        out["durationMs"] = m.duration_ms
    return out


def _dict_to_msg(raw: dict, position: int, key: bytes | None = None) -> ConversationMessage:
    usage = raw.get("usage")
    attachments = raw.get("attachments")
    content = raw.get("content") or ""
    reasoning = raw.get("reasoning") or None
    if key:
        content = encrypt_text(key, content)
        reasoning = encrypt_text(key, reasoning) if reasoning else None
    attachments_blob = json.dumps(attachments) if attachments else None
    return ConversationMessage(
        role=raw.get("role", "user"),
        content=content,
        reasoning=reasoning,
        encrypted=key is not None,
        model=raw.get("model") or None,
        usage=json.dumps(usage) if usage else None,
        attachments=attachments_blob,
        finish_reason=raw.get("finish_reason") or None,
        duration_ms=raw.get("durationMs") if isinstance(raw.get("durationMs"), (int, float)) else None,
        position=position,
    )


@router.get("/api/conversations")
async def list_conversations(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
):
    rows = (
        await db.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .options(selectinload(Conversation.messages))
            .order_by(Conversation.updated_at.desc())
        )
    ).scalars().all()
    return JSONResponse(
        content={
            "conversations": [
                {
                    "id": c.id,
                    "title": c.title,
                    "model": c.model,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                    "message_count": len(c.messages),
                }
                for c in rows
            ]
        },
        status_code=200,
    )


@router.get("/api/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
):
    conv = (
        await db.execute(
            select(Conversation)
            .where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
            .options(selectinload(Conversation.messages))
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    key = derive_key(
        conv.user_id, conv.id, chat_date_of(conv.created_at)
    ) if any(m.encrypted for m in conv.messages) else None
    return JSONResponse(
        content={
            "id": conv.id,
            "title": conv.title,
            "model": conv.model,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
            "messages": [_msg_to_dict(m, key) for m in conv.messages],
        },
        status_code=200,
    )


@router.post("/api/conversations")
async def create_conversation(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
    gw_db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    conv = Conversation(
        user_id=user_id,
        title=str(body.get("title") or "New Chat"),
        model=body.get("model") or None,
    )
    raw_messages = body.get("messages")
    if isinstance(raw_messages, list):
        conv.messages = [
            _dict_to_msg(m, i) for i, m in enumerate(raw_messages) if isinstance(m, dict)
        ]
    db.add(conv)
    await db.flush()
    if await _user_is_paid(gw_db, user_id):
        key = derive_key(user_id, conv.id, chat_date_of(conv.created_at))
        for msg in conv.messages:
            msg.content = encrypt_text(key, msg.content or "")
            msg.reasoning = encrypt_text(key, msg.reasoning) if msg.reasoning else None
            msg.encrypted = True
    await db.commit()
    await db.refresh(conv)
    return JSONResponse(
        content={"id": conv.id, "title": conv.title, "model": conv.model},
        status_code=201,
    )


@router.put("/api/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
    gw_db: AsyncSession = Depends(get_db),
):
    conv = (
        await db.execute(
            select(Conversation)
            .where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
            .options(selectinload(Conversation.messages))
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    if isinstance(body.get("title"), str) and body["title"].strip():
        conv.title = body["title"].strip()
    if isinstance(body.get("model"), str):
        conv.model = body["model"]

    messages = body.get("messages")
    if isinstance(messages, list):
        key = (
            derive_key(conv.user_id, conv.id, chat_date_of(conv.created_at))
            if await _user_is_paid(gw_db, conv.user_id)
            else None
        )
        # Replace the full message set (delete-orphan cascade clears removed ones).
        conv.messages = [_dict_to_msg(m, i, key) for i, m in enumerate(messages) if isinstance(m, dict)]

    await db.commit()
    return JSONResponse(content={"id": conv.id, "title": conv.title}, status_code=200)


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
):
    result = await db.execute(
        delete(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.commit()
    return JSONResponse(content={"ok": True}, status_code=200)