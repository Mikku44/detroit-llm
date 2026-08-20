import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth.session import require_session
from backend.db.database import get_db
from backend.db.models import Conversation, ConversationMessage

router = APIRouter()


def _msg_to_dict(m: ConversationMessage) -> dict:
    """Serialize a ConversationMessage row back into a Chat3 Msg shape."""
    out: dict = {"role": m.role, "content": m.content or ""}
    if m.reasoning:
        out["reasoning"] = m.reasoning
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


def _dict_to_msg(raw: dict, position: int) -> ConversationMessage:
    usage = raw.get("usage")
    attachments = raw.get("attachments")
    return ConversationMessage(
        role=raw.get("role", "user"),
        content=raw.get("content") or "",
        reasoning=raw.get("reasoning") or None,
        model=raw.get("model") or None,
        usage=json.dumps(usage) if usage else None,
        attachments=json.dumps(attachments) if attachments else None,
        finish_reason=raw.get("finish_reason") or None,
        duration_ms=raw.get("durationMs") if isinstance(raw.get("durationMs"), (int, float)) else None,
        position=position,
    )


@router.get("/api/conversations")
async def list_conversations(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
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
    return JSONResponse(
        content={
            "id": conv.id,
            "title": conv.title,
            "model": conv.model,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
            "messages": [_msg_to_dict(m) for m in conv.messages],
        },
        status_code=200,
    )


@router.post("/api/conversations")
async def create_conversation(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
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
        # Replace the full message set (delete-orphan cascade clears removed ones).
        conv.messages = [_dict_to_msg(m, i) for i, m in enumerate(messages) if isinstance(m, dict)]

    await db.commit()
    return JSONResponse(content={"id": conv.id, "title": conv.title}, status_code=200)


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
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