import json
import time
import asyncio
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.db.database import get_db
from backend.db.models import UsageLog, ApiKey
from backend.auth.middleware import require_api_key

router = APIRouter()

SGLANG_TIMEOUT = 300
DEEPSEEK_TIMEOUT = 300


def _has_image_content(body: dict) -> bool:
    for msg in body.get("messages", []):
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and (
                    part.get("type") == "image_url"
                    or "image_url" in part
                    or "inline_data" in part
                ):
                    return True
    return False


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


async def _proxy_stream(
    client: httpx.AsyncClient,
    payload: dict,
) -> AsyncGenerator[bytes, None]:
    async with client.stream("POST", f"{settings.sglang_url}/v1/chat/completions", json=payload) as resp:
        async for chunk in resp.aiter_bytes():
            yield chunk


def _parse_usage_from_chunk(chunk: bytes) -> dict | None:
    decoded = chunk.decode(errors="replace").strip()
    if decoded.startswith("data: ") and decoded != "data: [DONE]":
        try:
            data = json.loads(decoded[6:])
            if "usage" in data:
                return data["usage"]
        except json.JSONDecodeError:
            pass
    return None


def _deepseek_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.deepseek_api_key}",
    }


MOCK_TEXT = "สวัสดีครับ! นี่คือข้อความตอบกลับจำลอง (Mockup) สำหรับทดสอบระบบ Chat Completions API โดยไม่ต้องเชื่อมต่อกับ Server จริงครับ"


def _mock_payload(model: str, completion_id: str, created_time: int) -> dict:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created_time,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": MOCK_TEXT,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 15,
            "completion_tokens": len(MOCK_TEXT),
            "total_tokens": 15 + len(MOCK_TEXT),
        },
    }


@router.post("/v1/chat/completions")
@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    user_id: str = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    model = body.get("model", "deepseek-v4-pro")
    is_stream = body.get("stream", False)

    created_time = int(time.time())

    # If the request contains images but DeepSeek has no vision, route to Gemini.
    if _has_image_content(body) and settings.gemini_api_key:
        return await _proxy_to_gemini(db, user_id, body, is_stream)

    # If a DeepSeek key is configured, proxy to the real DeepSeek API.
    if settings.deepseek_api_key:
        return await _proxy_to_deepseek(db, user_id, model, body, is_stream)

    # Otherwise fall back to the mock response.
    completion_id = f"chatcmpl-mock-{created_time}"
    if is_stream:
        async def streaming_response():
            first_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": ""},
                    "finish_reason": None,
                }],
            }
            yield f"data: {json.dumps(first_chunk)}\n\n"
            await asyncio.sleep(0.1)

            for char in MOCK_TEXT:
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_time,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {"content": char},
                        "finish_reason": None,
                    }],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.03)

            final_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": 15,
                    "completion_tokens": len(MOCK_TEXT),
                    "total_tokens": 15 + len(MOCK_TEXT),
                },
            }
            yield f"data: {json.dumps(final_chunk)}\n\n"
            yield "data: [DONE]\n\n"

            await _log_usage(db, user_id, model, 15, len(MOCK_TEXT))

        return StreamingResponse(streaming_response(), media_type="text/event-stream")

    else:
        await asyncio.sleep(0.5)
        mock_payload = _mock_payload(model, completion_id, created_time)
        await _log_usage(db, user_id, model, 15, len(MOCK_TEXT))
        return JSONResponse(content=mock_payload, status_code=200)


async def _proxy_to_deepseek(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
):
    url = f"{settings.deepseek_url}/chat/completions"
    headers = _deepseek_headers()

    if is_stream:
        async def deepseek_stream():
            prompt_tokens = 0
            completion_tokens = 0
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            yield error_body
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            yield chunk
            finally:
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(deepseek_stream(), media_type="text/event-stream")

    else:
        async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT) as client:
            resp = await client.post(url, json=body, headers=headers)
            data = resp.json()
            usage = data.get("usage") or {}
            await _log_usage(
                db,
                user_id,
                model,
                usage.get("prompt_tokens", 0),
                usage.get("completion_tokens", 0),
            )
            return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_to_gemini(
    db: AsyncSession,
    user_id: str,
    body: dict,
    is_stream: bool,
):
    gemini_body = dict(body)
    gemini_body["model"] = settings.gemini_model
    url = f"{settings.gemini_url}/openai/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.gemini_api_key}",
    }

    if is_stream:
        async def gemini_stream():
            prompt_tokens = 0
            completion_tokens = 0
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT) as client:
                    async with client.stream("POST", url, json=gemini_body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            yield error_body
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            yield chunk
            finally:
                await _log_usage(db, user_id, settings.gemini_model, prompt_tokens, completion_tokens)

        return StreamingResponse(gemini_stream(), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT) as client:
        resp = await client.post(url, json=gemini_body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        await _log_usage(
            db,
            user_id,
            settings.gemini_model,
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
        )
        return JSONResponse(content=data, status_code=resp.status_code)


@router.get("/v1/models")
@router.get("/models")
async def list_models():
    # When a DeepSeek key is configured, return the real DeepSeek model list.
    if settings.deepseek_api_key:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{settings.deepseek_url}/models", headers=_deepseek_headers())
                return JSONResponse(content=resp.json(), status_code=resp.status_code)
        except httpx.ConnectError:
            pass

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(f"{settings.sglang_url}/v1/models")
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
        except httpx.ConnectError:
            return JSONResponse(
                content={
                    "object": "list",
                    "data": [
                        {"id": "deepseek-v4-pro", "object": "model", "created": 0, "owned_by": "deepseek"},
                        {"id": "deepseek-v4-flash", "object": "model", "created": 0, "owned_by": "deepseek"},
                    ],
                }
            )

