import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, delete
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
    content = m.content or ""
    reasoning = m.reasoning
    if m.encrypted and key:
        content = decrypt_text(key, content)
        reasoning = decrypt_text(key, reasoning) if reasoning else None
    out: dict = {"role": m.role, "content": content, "position": m.position}
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


def _maybe_upload_attachments(attachments):
    if not isinstance(attachments, list):
        return attachments
    try:
        from backend.storage.r2 import upload_data_uri, is_configured
        if not is_configured():
            return attachments
        out = []
        for a in attachments:
            if not isinstance(a, dict):
                out.append(a)
                continue
            du = a.get("dataUrl") or a.get("url") or ""
            if isinstance(du, str) and du.startswith("data:image"):
                url = upload_data_uri(du, prefix="images/uploads")
                if url:
                    a = {**a, "url": url, "dataUrl": None}
                    a.pop("dataUrl", None)
            out.append(a)
        return out
    except Exception as e:
        print(f"[r2] attachment upload skip: {e}")
        return attachments


def _dict_to_msg(raw: dict, position: int, key: bytes | None = None) -> ConversationMessage:
    usage = raw.get("usage")
    attachments = _maybe_upload_attachments(raw.get("attachments"))
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
    request: Request = None,
):
    limit = 50
    offset = 0
    if request is not None:
        try:
            limit = min(100, max(1, int(request.query_params.get("limit", "50"))))
            offset = max(0, int(request.query_params.get("offset", "0")))
        except Exception:
            pass
    total = (await db.execute(select(func.count(Conversation.id)).where(Conversation.user_id == user_id))).scalar_one() or 0
    rows = (
        await db.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    if rows:
        ids = [c.id for c in rows]
        counts = dict(
            (await db.execute(
                select(ConversationMessage.conversation_id, func.count(ConversationMessage.id))
                .where(ConversationMessage.conversation_id.in_(ids))
                .group_by(ConversationMessage.conversation_id)
            )).all()
        )
    else:
        counts = {}
    return JSONResponse(
        content={
            "conversations": [
                {
                    "id": c.id,
                    "title": c.title,
                    "model": c.model,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                    "message_count": int(counts.get(c.id, 0)),
                }
                for c in rows
            ],
            "total": total,
            "hasMore": offset + len(rows) < total,
        },
        status_code=200,
    )


@router.get("/api/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
    request: Request = None,
):
    limit = None
    before = None
    all_flag = False
    if request is not None:
        qp = request.query_params
        all_flag = qp.get("all") == "true"
        if qp.get("limit") is not None:
            try:
                limit = min(100, max(1, int(qp.get("limit"))))
            except Exception:
                limit = 30
        elif not all_flag:
            limit = 30
        if qp.get("before") is not None:
            try:
                before = int(qp.get("before"))
            except Exception:
                before = None
        elif qp.get("before_id") is not None:
            before = None
    conv = (
        await db.execute(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    total = (await db.execute(select(func.count(ConversationMessage.id)).where(ConversationMessage.conversation_id == conversation_id))).scalar_one() or 0
    q = select(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id)
    if before is not None:
        q = q.where(ConversationMessage.position < before)
    q = q.order_by(ConversationMessage.position.desc())
    if limit is not None and not all_flag:
        q = q.limit(limit)
    msgs = (await db.execute(q)).scalars().all()
    msgs = list(reversed(msgs))
    enc = (await db.execute(select(func.count(ConversationMessage.id)).where(ConversationMessage.conversation_id == conversation_id, ConversationMessage.encrypted == True))).scalar_one() or 0
    key = derive_key(conv.user_id, conv.id, chat_date_of(conv.created_at)) if enc else None
    has_more = False
    oldest = None
    if msgs:
        oldest = msgs[0].position
        if limit is not None and not all_flag:
            if before is None:
                has_more = total > len(msgs)
            else:
                cnt_before = (await db.execute(select(func.count(ConversationMessage.id)).where(ConversationMessage.conversation_id == conversation_id, ConversationMessage.position < oldest))).scalar_one() or 0
                has_more = cnt_before > 0
    return JSONResponse(
        content={
            "id": conv.id,
            "title": conv.title,
            "model": conv.model,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
            "messages": [_msg_to_dict(m, key) for m in msgs],
            "total": total,
            "hasMore": has_more,
            "oldestPosition": oldest,
        },
        status_code=200,
    )


@router.get("/api/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
    request: Request = None,
):
    return await get_conversation(conversation_id, user_id, db, request)


@router.post("/api/conversations/{conversation_id}/messages")
async def append_conversation_messages(
    conversation_id: str,
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
    gw_db: AsyncSession = Depends(get_db),
):
    conv = (
        await db.execute(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    body = await request.json()
    raw = body.get("messages") if isinstance(body, dict) and isinstance(body.get("messages"), list) else ([body] if isinstance(body, dict) and body.get("role") else [])
    if not raw:
        raise HTTPException(status_code=400, detail="messages is required")
    max_pos = (await db.execute(select(func.coalesce(func.max(ConversationMessage.position), -1)).where(ConversationMessage.conversation_id == conversation_id))).scalar_one()
    max_pos = int(max_pos) if max_pos is not None else -1
    is_paid = await _user_is_paid(gw_db, conv.user_id)
    key = derive_key(conv.user_id, conv.id, chat_date_of(conv.created_at)) if is_paid else None
    inserted = []
    for i, m in enumerate(raw):
        if not isinstance(m, dict):
            continue
        pos = max_pos + 1 + i
        msg = _dict_to_msg(m, pos, key)
        msg.conversation_id = conversation_id
        db.add(msg)
        inserted.append(msg)
    conv.updated_at = func.now()
    await db.flush()
    enc_cnt = (await db.execute(select(func.count(ConversationMessage.id)).where(ConversationMessage.conversation_id == conversation_id, ConversationMessage.encrypted == True))).scalar_one() or 0
    rkey = derive_key(conv.user_id, conv.id, chat_date_of(conv.created_at)) if enc_cnt else None
    await db.commit()
    return JSONResponse(content={"messages": [_msg_to_dict(m, rkey) for m in inserted], "total": max_pos + 1 + len(inserted)}, status_code=201)


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
        conv.messages = [_dict_to_msg(m, i, key) for i, m in enumerate(messages) if isinstance(m, dict)]

    await db.commit()
    return JSONResponse(content={"id": conv.id, "title": conv.title}, status_code=200)


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_conversation_db),
):
    try:
        result = await db.execute(
            delete(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        print(f"[conversations] delete failed {conversation_id} user={user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete conversation")
    return JSONResponse(content={"ok": True}, status_code=200)
