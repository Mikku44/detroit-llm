import asyncio
import json
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

_CHAT_SEM = asyncio.Semaphore(20)
_USER_CHAT_SEMS: dict[str, asyncio.Semaphore] = {}
_USER_CHAT_LOCK = asyncio.Lock()

async def _acquire_chat_slot(user_id: str):
    await _CHAT_SEM.acquire()
    async with _USER_CHAT_LOCK:
        sem = _USER_CHAT_SEMS.get(user_id)
        if sem is None:
            sem = asyncio.Semaphore(3)
            _USER_CHAT_SEMS[user_id] = sem
    await sem.acquire()
    return sem

def _release_chat_slot(sem: asyncio.Semaphore):
    try:
        sem.release()
    except Exception:
        pass
    try:
        _CHAT_SEM.release()
    except Exception:
        pass

from backend.config import settings
from backend.auth.session import require_session
from backend.db.database import get_db
from backend.db.models import UsageLog, ApiKey

router = APIRouter()

SGLANG_TIMEOUT = 300


async def _find_api_key(db: AsyncSession, user_id: str) -> ApiKey | None:
    from sqlalchemy import select
    stmt = select(ApiKey).where(ApiKey.user_id == user_id, ApiKey.is_active == True).limit(1)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _log_usage(
    db: AsyncSession,
    user_id: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
):
    api_key = await _find_api_key(db, user_id)
    if api_key:
        log = UsageLog(
            api_key_id=api_key.id,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )
        db.add(log)
        await db.commit()


async def _sglang_text_deltas(payload: dict, request: Request) -> AsyncGenerator[str, None]:
    """Stream just the text content from SGLang's SSE chat completions response."""
    async with httpx.AsyncClient(timeout=SGLANG_TIMEOUT) as client:
        async with client.stream(
            "POST",
            f"{settings.sglang_url}/v1/chat/completions",
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                raw = (await resp.aread()).decode(errors="replace")
                raise RuntimeError(f"SGLang upstream error {resp.status_code}: {raw[:300]}")
            
            async for line in resp.aiter_lines():
                # ตรวจสอบว่าผู้ใช้กด Cancel ใน Frontend หรือยัง
                if await request.is_disconnected():
                    break

                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                    delta = obj["choices"][0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield content
                except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                    continue


@router.post("/api/chat/stream")
async def chat_stream(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    ctype = request.headers.get("content-length")
    if ctype and ctype.isdigit() and int(ctype) > 1 << 20:
        raise HTTPException(status_code=413, detail="Payload too large")
    sem = await _acquire_chat_slot(user_id)
    try:
        body = await request.json()
        if body.get("max_tokens") is not None:
            try:
                body["max_tokens"] = min(max(1, int(body["max_tokens"])), 8192)
            except Exception:
                body["max_tokens"] = 4096
        messages = body.get("messages", [])

        if not isinstance(messages, list) or not messages:
            raise HTTPException(status_code=400, detail="'messages' must be a non-empty list")

        model = body.get("model", "google/gemma-4-26B-A4B")
        payload = {
            "model": model,
            "messages": messages,
            "temperature": body.get("temperature", 0.7),
            "max_tokens": body.get("max_tokens", 4096),
            "stream": True,
        }

        prompt_chars = sum(
            len(m.get("content", ""))
            for m in messages
            if isinstance(m, dict) and isinstance(m.get("content"), str)
        )
        prompt_tokens = max(1, prompt_chars // 4)

        async def event_stream():
            completion_chars = 0
            ok = True
            try:
                async for delta in _sglang_text_deltas(payload, request):
                    completion_chars += len(delta)
                    yield delta
            except Exception as e:
                ok = False
                yield f"\n[Error] {e}"
            finally:
                _release_chat_slot(sem)
                if ok:
                    try:
                        await _log_usage(db, user_id, model, prompt_tokens, max(1, completion_chars // 4))
                    except Exception:
                        pass

        return StreamingResponse(
            event_stream(),
            media_type="text/plain; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except HTTPException:
        _release_chat_slot(sem)
        raise
    except Exception:
        _release_chat_slot(sem)
        raise