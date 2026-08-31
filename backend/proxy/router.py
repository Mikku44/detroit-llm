import base64
import hashlib
import json
import re
import time
import asyncio
from urllib.parse import unquote
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

_IS_TEST = bool(os.getenv("PYTEST_CURRENT_TEST"))

from cachetools import TTLCache

from backend.config import settings, TIER_OPTIONS
from backend.db.database import get_db
from backend.db.models import UsageLog, ApiKey, User, ImageUsage
from backend.auth.middleware import require_api_key
from backend.auth.session import require_session
from backend.proxy.tokens import count_messages_tokens, count_text_tokens, count_responses_input_tokens

_usage_cache: TTLCache = TTLCache(maxsize=2048, ttl=45)
_user_cache: TTLCache = TTLCache(maxsize=1024, ttl=60)
_models_cache: dict = {}

router = APIRouter()

SGLANG_TIMEOUT = 300
DEEPSEEK_TIMEOUT = 300

# DeepSeek-only chat params that Gemini's OpenAI-compatible endpoint may reject.
GEMINI_STRIP_KEYS = ("reasoning", "output_config", "reasoning_effort", "thinking")

_NATIVE_VISION_EXACT = {"deepseek-v4-flash-vision-exp"}
_NATIVE_VISION_PREFIXES = ("qwen", "glm-", "stealth/")


def _supports_native_vision(model: str) -> bool:
    m = (model or "").lower()
    if m in _NATIVE_VISION_EXACT:
        return True
    for p in _NATIVE_VISION_PREFIXES:
        if m.startswith(p):
            return True
    if "vision" in m or "-vl" in m or "4.6v" in m:
        return True
    return False


def _extract_upstream_error_message(raw: bytes, default: str = "Upstream request failed") -> str:
    try:
        data = json.loads(raw.decode(errors="replace"))
    except Exception:
        try:
            text = raw.decode(errors="replace").strip()
            return text[:500] if text else default
        except Exception:
            return default
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            code = err.get("code")
            msg = err.get("message") or err.get("msg") or err.get("detail")
            if msg:
                return f"[{code}] {msg}" if code else str(msg)
            if isinstance(code, str) and code:
                return f"[{code}] {default}"
        if isinstance(data.get("message"), str) and data["message"]:
            return data["message"]
        if isinstance(data.get("detail"), str) and data["detail"]:
            return data["detail"]
        try:
            return json.dumps(data, ensure_ascii=False)[:500]
        except Exception:
            pass
    return default


def _sse_error_chunk(message: str, model: str) -> bytes:
    payload = {"choices": [{"index": 0, "delta": {"content": message}, "finish_reason": None}], "model": model, "object": "chat.completion.chunk"}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode(errors="replace")


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


def _has_video_content(body: dict) -> bool:
    for msg in body.get("messages", []):
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and (
                    part.get("type") == "video_url" or "video_url" in part
                ):
                    return True
    return False


RESPONSES_IMAGE_PART_TYPES = ("input_image", "image_url")
RESPONSES_VIDEO_PART_TYPES = ("input_video", "video_url")


def _responses_has_image(input_data) -> bool:
    """Detect image content in a Responses API `input` (list of items)."""
    for item in input_data or []:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") in RESPONSES_IMAGE_PART_TYPES:
                    return True
    return False


def _responses_has_video(input_data) -> bool:
    for item in input_data or []:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") in RESPONSES_VIDEO_PART_TYPES:
                    return True
    return False


def _responses_to_chat_messages(input_data) -> list:
    """Convert a Responses API `input` list into OpenAI chat-completions messages."""
    messages = []
    for item in input_data or []:
        if isinstance(item, str):
            messages.append({"role": "user", "content": item})
            continue
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message" or ("role" in item and "content" in item):
            role = item.get("role", "user")
            if role not in ("user", "assistant", "system"):
                role = "user"
            content = item.get("content")
            if isinstance(content, str):
                messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    ptype = part.get("type")
                    if ptype in ("input_text", "text", "output_text"):
                        text = part.get("text")
                        if text:
                            parts.append({"type": "text", "text": text})
                    elif ptype in RESPONSES_IMAGE_PART_TYPES:
                        url = part.get("image_url")
                        if isinstance(url, dict):
                            url = url.get("url")
                        if url:
                            parts.append({"type": "image_url", "image_url": {"url": url}})
                if parts:
                    messages.append({"role": role, "content": parts})
        elif item_type == "function_call_output":
            call_id = item.get("call_id")
            output = item.get("output")
            if isinstance(output, list):
                output = "".join(
                    (p.get("text") or "") for p in output if isinstance(p, dict)
                )
            msg = {"role": "tool", "content": str(output) if output is not None else ""}
            if call_id:
                msg["tool_call_id"] = call_id
            messages.append(msg)
    return messages


def _responses_tools_to_chat_tools(tools) -> list:
    """Wrap flat Responses-style function tools into chat-completions format."""
    out = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") == "function":
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "parameters": tool.get("parameters"),
                    },
                }
            )
    return out


def _responses_tool_choice_to_chat(tool_choice):
    if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
        return {"type": "function", "function": {"name": tool_choice.get("name")}}
    return tool_choice


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Hard cap on any single streaming response. Prevents a misbehaving upstream
# (or a stuck connection) from streaming forever and hanging the client.
STREAM_MAX_SECONDS = 300
STREAM_IDLE_SECONDS = 60
_STREAM_WARNING = b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\ndata: [DONE]\n\n'


async def _deadline_wrapper(agen: AsyncGenerator[bytes, None], max_seconds: int = STREAM_MAX_SECONDS) -> AsyncGenerator[bytes, None]:
    """Wrap an upstream SSE generator with a hard timeout.

    - Global deadline: if the stream has run for more than `max_seconds` total,
      force-finish.
    - Idle deadline: if no chunk arrives within `STREAM_IDLE_SECONDS`, the
      connection is likely stuck — force-finish.

    Either way the client always receives a terminating `[DONE]`.
    """
    started = time.monotonic()
    try:
        while True:
            remaining = started + max_seconds - time.monotonic()
            if remaining <= 0:
                yield _STREAM_WARNING
                return
            try:
                chunk = await asyncio.wait_for(
                    anext(agen),
                    timeout=min(remaining, STREAM_IDLE_SECONDS),
                )
            except asyncio.TimeoutError:
                yield _STREAM_WARNING
                return
            except StopAsyncIteration:
                return
            yield chunk
    except asyncio.CancelledError:
        raise
    except Exception:
        # Never let an upstream error hang the client.
        yield _STREAM_WARNING
        return
    finally:
        await agen.aclose()


def _safe_stream(agen_factory):
    """Return a StreamingResponse whose body_iterator is deadline-protected.

    Accepts a callable returning an async generator (so the generator is created
    lazily inside the response), then wraps it with `_deadline_wrapper`.
    """
    async def _body():
        agen = agen_factory()
        async for chunk in _deadline_wrapper(agen):
            yield chunk
    return StreamingResponse(_body(), media_type="text/event-stream")


def _chat_chunk_to_responses_events(chunk: bytes, output_text: list, tool_calls: list) -> list:
    """Translate chat-completions SSE chunk bytes into Responses API stream events."""
    events = []
    for raw_line in chunk.decode(errors="replace").split("\n"):
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        for choice in data.get("choices") or []:
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if isinstance(content, str) and content:
                output_text.append(content)
                events.append(
                    (
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "delta": content,
                            "item_id": "msg_responses",
                            "output_index": 0,
                            "content_index": 0,
                        },
                    )
                )
            for tc in delta.get("tool_calls") or []:
                fn = tc.get("function") or {}
                index = tc.get("index", len(tool_calls))
                while len(tool_calls) <= index:
                    tool_calls.append({"id": "", "name": "", "arguments": ""})
                if isinstance(tc.get("id"), str):
                    tool_calls[index]["id"] = tc["id"]
                if isinstance(fn.get("name"), str):
                    tool_calls[index]["name"] += fn["name"]
                if isinstance(fn.get("arguments"), str):
                    tool_calls[index]["arguments"] += fn["arguments"]
    return events


def _build_responses_output(output_text: str, tool_calls: list) -> list:
    """Build a Responses API `output` item list from text + chat tool calls."""
    output = []
    if output_text:
        output.append(
            {
                "type": "message",
                "id": "msg_responses",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": output_text, "annotations": []}],
            }
        )
    for i, tc in enumerate(tool_calls):
        output.append(
            {
                "type": "function_call",
                "id": f"fc_{i}",
                "call_id": tc.get("id") or f"call_{i}",
                "name": tc.get("name", ""),
                "arguments": tc.get("arguments", ""),
                "status": "completed",
            }
        )
    return output


async def _find_api_key(db: AsyncSession, user_id: str) -> ApiKey | None:
    from sqlalchemy import select
    stmt = select(ApiKey).where(ApiKey.user_id == user_id, ApiKey.is_active == True).limit(1)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _tier_usage(db: AsyncSession, user_id: str) -> tuple[int, int]:
    if not os.getenv("PYTEST_CURRENT_TEST"):
        cached = _usage_cache.get(user_id)
        if cached is not None:
            return cached
    from sqlalchemy import func, select

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async def sum_since(cutoff) -> int:
        stmt = (
            select(func.coalesce(func.sum(UsageLog.total_tokens), 0))
            .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
            .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        )
        result = await db.execute(stmt)
        return int(result.scalar_one())

    weekly = await sum_since(now - timedelta(days=7))
    monthly = await sum_since(now - timedelta(days=30))
    if not os.getenv("PYTEST_CURRENT_TEST"):
        _usage_cache[user_id] = (weekly, monthly)
    return weekly, monthly


def _invalidate_usage_cache(user_id: str) -> None:
    _usage_cache.pop(user_id, None)


async def _cached_user(db: AsyncSession, user_id: str) -> User | None:
    if not os.getenv("PYTEST_CURRENT_TEST"):
        cached = _user_cache.get(user_id)
        if cached is not None:
            return cached
    from sqlalchemy import select
    stmt = select(User).where(User.id == user_id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user and not os.getenv("PYTEST_CURRENT_TEST"):
        _user_cache[user_id] = user
    return user


async def require_access(
    user_id: str = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Gate the OpenAI-compatible API by tier.

    Owner/member tiers have unlimited access. Free-tier users are allowed in but
    limited to a weekly and monthly total-token budget.
    """
    user = await _cached_user(db, user_id)
    if not user:
        raise HTTPException(status_code=403, detail="Membership required")

    # A tier_id (Stripe subscription or the YouTube level→tier mapping) carries
    # a weekly/monthly token budget that is enforced for everyone — including
    # owners/members. e.g. the owner subscribed to the nomad tier is gated by
    # the nomad limits once they run out.
    tier = next((t for t in TIER_OPTIONS if t["id"] == user.tier_id), None)
    if tier and tier["id"] != "free":
        weekly_used, monthly_used = await _tier_usage(db, user_id)
        if weekly_used >= tier["weekly"]:
            raise HTTPException(
                status_code=403,
                detail="Weekly limit reached. Upgrade to a higher tier or wait for the weekly window to reset.",
            )
        if monthly_used >= tier["monthly"]:
            raise HTTPException(
                status_code=403,
                detail="Monthly limit reached. Upgrade to a higher tier or wait for the monthly window to reset.",
            )
        return user_id

    if user.is_member or user.is_owner or user.is_paid:
        return user_id

    # Live membership check: even if the stored flag is stale (e.g. the user
    # became a member after their last login), grant access now if their channel
    # is on the freshest member list. No re-login required.
    from backend.auth.members import is_member_channel
    if user.youtube_channel_id and await is_member_channel(user.youtube_channel_id):
        user.is_member = True
        await db.commit()
        return user_id

    weekly_used, monthly_used = await _tier_usage(db, user_id)
    if weekly_used >= settings.free_weekly_tokens:
        raise HTTPException(
            status_code=403,
            detail="Weekly limit reached. Upgrade to a paid membership for more usage.",
        )
    if monthly_used >= settings.free_monthly_tokens:
        raise HTTPException(
            status_code=403,
            detail="Monthly limit reached. Upgrade to a paid membership for more usage.",
        )
    return user_id


FREE_MODEL_ONLY_MESSAGE = (
    "Free tier only includes the flash and glm-5.3-flash models. "
    "Upgrade to a paid membership for pro and other models."
)

FREE_TIER_EXTRA_MODELS = {"glm-4.5-air", "glm-4.7-flashx"}

MODEL_TOKEN_LIMITS: dict[str, tuple[int, int]] = {
    "glm-5.3": (65536, 131072),
    "glm-5.3-flash": (65536, 131072),
    "glm-5.2": (65536, 131072),
    "glm-5.1": (65536, 131072),
    "glm-5": (65536, 131072),
    "glm-4.7": (65536, 131072),
    "glm-4.7-flashx": (65536, 131072),
    "glm-4.6": (65536, 131072),
    "glm-4.6v": (16384, 32768),
    "glm-4.6v-flash": (16384, 32768),
    "glm-4.6v-flashx": (16384, 32768),
    "glm-4.5": (65536, 98304),
    "glm-4.5-air": (65536, 98304),
    "glm-4.5-x": (65536, 98304),
    "glm-4.5-airx": (65536, 98304),
    "glm-4.5-flash": (65536, 98304),
    "glm-4.5v": (16384, 16384),
    "glm-4-32b-0414-128k": (16384, 16384),
}


def _model_token_limits(model: str) -> tuple[int, int] | None:
    if not model:
        return None
    return MODEL_TOKEN_LIMITS.get(model.lower())


def _apply_max_tokens(body: dict, model: str) -> None:
    limits = _model_token_limits(model)
    if limits is None:
        if not body.get("max_tokens"):
            body["max_tokens"] = 4096
        return
    default, maximum = limits
    requested = body.get("max_tokens")
    if not requested:
        body["max_tokens"] = default
    else:
        try:
            v = int(requested)
        except Exception:
            body["max_tokens"] = default
            return
        body["max_tokens"] = min(max(1, v), maximum)


def _apply_max_output_tokens(body: dict, model: str) -> None:
    limits = _model_token_limits(model)
    if limits is None:
        return
    default, maximum = limits
    key = "max_output_tokens" if "max_output_tokens" in body else "max_tokens" if "max_tokens" in body else None
    if key is None:
        body["max_output_tokens"] = default
        return
    try:
        v = int(body[key])
    except Exception:
        body[key] = default
        return
    body[key] = min(max(1, v), maximum)


def _is_flash_model(model: str) -> bool:
    """True when the requested model (or its resolved upstream) is a flash model."""
    if not model:
        return False
    resolved = _resolve_model(model)
    return "flash" in model.lower() or "flash" in resolved.lower()


def _is_free_tier_model(model: str) -> bool:
    """True when the requested model is allowed on the free tier (flash or ox-alpha)."""
    if not model:
        return False
    # Paid visions/models that contain "flash" but are member-only
    if model.lower() in ("deepseek-v4-flash-vision-exp", "glm-5.3", "glm-5.3-flash"):
        return False
    if model.lower() in FREE_TIER_EXTRA_MODELS:
        return True
    return _is_flash_model(model)


async def _is_free_user(db: AsyncSession, user_id: str) -> bool:
    from sqlalchemy import select
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        return True
    if user.is_member or user.is_owner or user.is_paid:
        return False
    # Live membership check so newly-added members aren't treated as free.
    from backend.auth.members import is_member_channel
    if user.youtube_channel_id and await is_member_channel(user.youtube_channel_id):
        user.is_member = True
        await db.commit()
        return False
    return True


async def _free_model_gate(db: AsyncSession, user_id: str, body: dict, default_model: str = "deepseek-v4-pro") -> str:
    """Enforce that free-tier users only use free-tier models. Returns the model to use.

    Free users default to the flash model when none is specified; an explicit
    non-free model is rejected with 403. Member/owner users are unaffected.
    Vision models (deepseek-v4-flash-vision-exp) require a paid/member tier.
    """
    model = body.get("model", default_model)

    # Vision models are paid/member-only, even though their name contains "flash".
    if model.lower() == "deepseek-v4-flash-vision-exp":
        if await _is_free_user(db, user_id):
            raise HTTPException(
                status_code=403,
                detail=(
                    "deepseek-v4-flash-vision-exp is only available to paid members. "
                    "Upgrade to a paid membership for vision access."
                ),
            )
        return model

    if _is_free_tier_model(model):
        return model
    # Image-only models are allowed for free tier (quota enforced separately)
    if model.lower() in {"z-image-turbo", "gpt-image-1", "dall-e-3", "gemini-2.0-flash-preview-image-generation"}:
        return model
    if not await _is_free_user(db, user_id):
        return model
    if not body.get("model"):
        model = "deepseek-v4-flash"
        body["model"] = model
        return model
    raise HTTPException(status_code=403, detail=FREE_MODEL_ONLY_MESSAGE)


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
        _invalidate_usage_cache(user_id)


# ---------------------------------------------------------------------------
# Image generation quota (per-tier, monthly)
# ---------------------------------------------------------------------------

_IMAGE_QUOTA_BY_TIER = {t["id"]: t.get("image_quota", 0) for t in TIER_OPTIONS}

# Owner + YouTube members are not limited by the Stripe tier table; treat them
# like the top paid tier (practically unlimited quota).
_MEMBER_IMAGE_QUOTA = 10_000


async def _image_quota_for_user(db: AsyncSession, user_id: str) -> tuple[int, int]:
    """Return (quota, used) images for the user's current tier this calendar month.

    Tier resolution: owner/member -> unlimited-ish; paid Stripe users use their
    stored tier_id (nomad/dreamer/entrepreneur/angel); everyone else -> free (2).
    """
    from sqlalchemy import func, select

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user and (user.is_owner or user.is_member):
        quota = _MEMBER_IMAGE_QUOTA
    elif user and user.is_paid:
        quota = _IMAGE_QUOTA_BY_TIER.get(user.tier_id or "", _IMAGE_QUOTA_BY_TIER["free"])
    else:
        quota = _IMAGE_QUOTA_BY_TIER["free"]

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    month_start = now_naive.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used_stmt = select(func.count(ImageUsage.id)).where(
        ImageUsage.user_id == user_id, ImageUsage.created_at >= month_start
    )
    used = int((await db.execute(used_stmt)).scalar_one() or 0)
    return quota, used


async def _check_image_quota(db: AsyncSession, user_id: str):
    """Raise 403 when the user has used their monthly image quota."""
    quota, used = await _image_quota_for_user(db, user_id)
    if quota <= 0:
        raise HTTPException(
            status_code=403,
            detail="Image generation is not included in your plan. Upgrade to generate images.",
        )
    if used >= quota:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Monthly image quota reached ({used}/{quota}). "
                "Upgrade to a higher tier for more images, or wait until next month."
            ),
        )


async def _log_image_usage(db: AsyncSession, user_id: str, model: str):
    db.add(ImageUsage(user_id=user_id, model=model))
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


def _text_from_chunk(chunk: bytes) -> str:
    """Extract delta content + reasoning + tool call args from a single SSE chunk for local token counting."""
    decoded = chunk.decode(errors="replace").strip()
    if not decoded.startswith("data: ") or decoded == "data: [DONE]":
        return ""
    try:
        data = json.loads(decoded[6:])
    except json.JSONDecodeError:
        return ""
    parts = []
    for choice in data.get("choices") or []:
        delta = choice.get("delta") or {}
        content = delta.get("content")
        reasoning = delta.get("reasoning_content")
        if isinstance(content, str):
            parts.append(content)
        if isinstance(reasoning, str):
            parts.append(reasoning)
        for tool_call in delta.get("tool_calls") or []:
            function = tool_call.get("function") or {}
            if isinstance(function.get("name"), str):
                parts.append(function["name"])
            if isinstance(function.get("arguments"), str):
                parts.append(function["arguments"])
    return "".join(parts)


def _responses_usage_from_chunk(chunk: bytes) -> dict | None:
    """Extract usage from a Responses API SSE event (`response.completed` carries it)."""
    decoded = chunk.decode(errors="replace").strip()
    if not decoded.startswith("data: ") or decoded == "data: [DONE]":
        return None
    try:
        data = json.loads(decoded[6:])
    except json.JSONDecodeError:
        return None
    if data.get("type") == "response.completed":
        usage = (data.get("response") or {}).get("usage")
        if isinstance(usage, dict):
            return usage
    return None


def _responses_text_from_chunk(chunk: bytes) -> str:
    """Extract output text deltas + tool call arguments from a Responses SSE event."""
    decoded = chunk.decode(errors="replace").strip()
    if not decoded.startswith("data: ") or decoded == "data: [DONE]":
        return ""
    try:
        data = json.loads(decoded[6:])
    except json.JSONDecodeError:
        return ""
    event_type = data.get("type")
    if event_type == "response.output_text.delta":
        delta = data.get("delta")
        return delta if isinstance(delta, str) else ""
    if event_type == "response.function_call_arguments.delta":
        delta = data.get("delta")
        return delta if isinstance(delta, str) else ""
    return ""


def _responses_output_text(data: dict) -> str:
    """Extract all text + tool arguments from a completed (non-streaming) Responses payload."""
    parts = []
    for item in data.get("output") or []:
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("type") == "output_text":
                    text = part.get("text")
                    if isinstance(text, str):
                        parts.append(text)
        elif item.get("type") == "function_call":
            args = item.get("arguments")
            if isinstance(args, str):
                parts.append(args)
    return "".join(parts)


def _anthropic_system_to_chat(system) -> str:
    """Extract Anthropic `system` (string or block list) into plain text."""
    if isinstance(system, str):
        return system
    parts = []
    for block in system or []:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts)


def _anthropic_content_to_chat(content) -> str | list:
    """Convert an Anthropic content array (text/image blocks) to OpenAI chat parts."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text" and isinstance(block.get("text"), str):
            parts.append({"type": "text", "text": block["text"]})
        elif btype == "image":
            source = block.get("source") or {}
            data = source.get("data")
            media_type = source.get("media_type", "image/png")
            if data:
                url = f"data:{media_type};base64,{data}"
                parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _anthropic_tools_to_chat(tools) -> list:
    """Convert Anthropic flat tools ({name, description, input_schema}) to OpenAI function format."""
    out = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") != "function":
            continue
        out.append(
            {
                "type": "function",
                "function": {
                    "name": tool.get("name"),
                    "description": tool.get("description"),
                    "parameters": tool.get("input_schema"),
                },
            }
        )
    return out


def _anthropic_tool_choice_to_chat(tool_choice) -> dict | str | None:
    if isinstance(tool_choice, dict):
        ttype = tool_choice.get("type")
        if ttype == "tool":
            name = tool_choice.get("name")
            if name:
                return {"type": "function", "function": {"name": name}}
        if ttype == "any":
            return "required"
        if ttype == "auto":
            return "auto"
    return tool_choice


def _anthropic_to_chat_messages(body: dict) -> list:
    """Translate Anthropic `system` + `messages` into OpenAI chat messages."""
    messages = []
    system = _anthropic_system_to_chat(body.get("system"))
    if system:
        messages.append({"role": "system", "content": system})
    for m in body.get("messages") or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role", "user")
        content = m.get("content")
        # tool_result blocks become OpenAI tool messages; keep other blocks as user text.
        if isinstance(content, list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in content
        ):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_result":
                    tool_content = block.get("content")
                    if isinstance(tool_content, str):
                        text = tool_content
                    elif isinstance(tool_content, list):
                        text = "".join(
                            (p.get("text") or "") for p in tool_content if isinstance(p, dict)
                        )
                    else:
                        text = ""
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": block.get("tool_use_id") or "",
                            "content": text,
                        }
                    )
                elif block.get("type") == "text" and isinstance(block.get("text"), str):
                    messages.append({"role": "user", "content": block["text"]})
            continue
        messages.append({"role": role, "content": _anthropic_content_to_chat(content)})
    return messages


def _anthropic_has_image(body: dict) -> bool:
    """Detect image blocks in Anthropic Messages format."""
    for msg in body.get("messages") or []:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image":
                    return True
    return False


def _anthropic_has_video(body: dict) -> bool:
    for msg in body.get("messages") or []:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "video":
                    return True
    return False


def _anthropic_stop_reason(finish_reason) -> str:
    return {
        "length": "max_tokens",
        "stop": "end_turn",
        "tool_calls": "tool_use",
        "function_call": "tool_use",
        "content_filter": "refusal",
    }.get(finish_reason, "end_turn")


def _anthropic_usage(usage: dict) -> dict:
    usage = usage or {}
    prompt = usage.get("prompt_tokens") or 0
    completion = usage.get("completion_tokens") or 0
    return {
        "input_tokens": prompt or usage.get("input_tokens") or 0,
        "output_tokens": completion or usage.get("output_tokens") or 0,
    }


def _build_anthropic_message(model: str, text: str, tool_calls: list, finish_reason) -> dict:
    """Build an Anthropic Messages response body from chat-completion fields."""
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for i, tc in enumerate(tool_calls or []):
        try:
            arguments = json.loads(tc.get("arguments") or "{}")
        except json.JSONDecodeError:
            arguments = {}
        content.append(
            {
                "type": "tool_use",
                "id": tc.get("id") or f"toolu_{i + 1}",
                "name": tc.get("name") or "",
                "input": arguments if isinstance(arguments, dict) else {},
            }
        )
    return {
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": _anthropic_stop_reason(finish_reason),
        "stop_sequence": None,
    }


def _anthropic_chat_chunk_to_events(chunk: bytes, meta: dict) -> list:
    """Translate chat-completions SSE chunk bytes into Anthropic Messages stream events.

    meta: {'message_id', 'model', 'output_text': list, 'tool_calls': list, 'block_started': bool}
    """
    events = []
    for raw_line in chunk.decode(errors="replace").split("\n"):
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        for choice in data.get("choices") or []:
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if isinstance(content, str) and content:
                if not meta["block_started"]:
                    meta["block_started"] = True
                    events.append(
                        _sse_event(
                            "content_block_start",
                            {
                                "type": "content_block_start",
                                "index": 0,
                                "content_block": {"type": "text", "text": ""},
                            },
                        )
                    )
                meta["output_text"].append(content)
                events.append(
                    _sse_event(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": 0,
                            "delta": {"type": "text_delta", "text": content},
                        },
                    )
                )
            for tc in delta.get("tool_calls") or []:
                fn = tc.get("function") or {}
                index = tc.get("index", len(meta["tool_calls"]))
                while len(meta["tool_calls"]) <= index:
                    meta["tool_calls"].append({"id": "", "name": "", "arguments": ""})
                if isinstance(tc.get("id"), str):
                    meta["tool_calls"][index]["id"] = tc["id"]
                if isinstance(fn.get("name"), str):
                    meta["tool_calls"][index]["name"] += fn["name"]
                if isinstance(fn.get("arguments"), str):
                    meta["tool_calls"][index]["arguments"] += fn["arguments"]
    return events


def _emit_anthropic_message_stop(meta: dict, finish_reason) -> str:
    """One-shot sse builders for stream end (content_block_stop + message_delta + message_stop)."""
    events = []
    if meta["block_started"] or meta["tool_calls"]:
        if meta["block_started"]:
            events.append(
                _sse_event(
                    "content_block_stop",
                    {"type": "content_block_stop", "index": 0},
                )
            )
        for i in range(len(meta["tool_calls"])):
            events.append(
                _sse_event(
                    "content_block_stop",
                    {"type": "content_block_stop", "index": i},
                )
            )
    events.append(
        _sse_event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": _anthropic_stop_reason(finish_reason), "stop_sequence": None},
                "usage": {
                    "output_tokens": count_text_tokens("".join(meta["output_text"])),
                },
            },
        )
    )
    events.append(_sse_event("message_stop", {"type": "message_stop"}))
    return "".join(events)


def _deepseek_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.deepseek_api_key}",
    }


def _dashscope_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.dashscope_api_key}",
    }


def fallback_prompt_tokens_for(messages: list) -> int:
    """Best-effort fallback token estimate for a raw messages list."""
    try:
        return count_messages_tokens(messages)
    except Exception:
        chars = sum(
            len(m.get("content", ""))
            for m in messages
            if isinstance(m, dict) and isinstance(m.get("content"), str)
        )
        return max(1, chars // 4)


def _log_message_text(content) -> str:
    """Extract readable text from a message content (string or list of parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    parts.append(part.get("text", ""))
                elif part.get("type") == "image_url" or "image_url" in part:
                    parts.append("[image]")
                elif "inline_data" in part:
                    parts.append("[image]")
                else:
                    parts.append(f"[{part.get('type', 'part')}]")
        return " ".join(p for p in parts if p)
    return str(content)


def _extract_stream_text(raw: bytes) -> str:
    """Extract assistant text content from raw SSE stream bytes (chat completions)."""
    text = raw.decode(errors="replace")
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            try:
                obj = json.loads(line)
                if isinstance(obj, dict) and obj.get("error"):
                    return json.dumps(obj["error"], ensure_ascii=False)
            except json.JSONDecodeError:
                pass
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            continue
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        choices = obj.get("choices") or []
        for ch in choices:
            delta = ch.get("delta") or ch.get("message") or {}
            content = delta.get("content")
            if isinstance(content, str):
                out.append(content)
    return "".join(out)


def _print_request_log(user_id: str, model: str, messages: list) -> None:
    print("\n" + "=" * 80)
    print(f"[CHAT] user={user_id} model={model}")
    for m in messages:
        role = m.get("role", "?")
        print(f"  {role}: {_log_message_text(m.get('content', ''))}")


def _with_log(resp, user_id: str, model: str, messages: list):
    """Wrap a StreamingResponse or JSONResponse to print request + response to terminal."""
    # _print_request_log(user_id, model, messages)

    def safe_print(text: str) -> None:
        try:
            print(text)
        except UnicodeEncodeError:
            import sys
            stream = getattr(sys.stdout, "buffer", None)
            if stream is not None:
                encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
                stream.write((text + "\n").encode(encoding, errors="replace"))
                stream.flush()
            else:
                print(text.encode("utf-8", errors="replace"))

    if isinstance(resp, StreamingResponse):
        original = resp.body_iterator

        async def wrapped():
            chunks = []
            status = "ok"
            try:
                async for chunk in original:
                    chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode(errors="replace"))
                    yield chunk
            except Exception as e:
                status = f"error: {type(e).__name__}: {e}"
                raise
            finally:
                raw = b"".join(chunks)
                text = _extract_stream_text(raw) or "(no text)"
                safe_print(f"  -> [{status}] {text}")
                safe_print("=" * 80)

        resp.body_iterator = wrapped()
        return resp

    try:
        payload = json.loads(resp.body.decode(errors="replace"))
    except Exception:
        payload = {}
    if isinstance(payload, dict) and "error" in payload:
        safe_print(f"  -> [error] {json.dumps(payload['error'], ensure_ascii=False)}")
    else:
        content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
        safe_print(f"  -> [ok] {content}")
    safe_print("=" * 80)
    return resp


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


# ---------------------------------------------------------------------------
# Image-intent tool loop (JSON envelope protocol: model returns
# {content, tool_call: "image_gen"} -> gateway executes image tool -> round 2)
# ---------------------------------------------------------------------------

_IMAGE_INTENT_KEYWORDS = (
    r"(สร้างรูป|วาดรูป|ทำรูป|สร้างภาพ|วาดภาพ|ทำภาพ|อยากได้รูป|รูปให้|ภาพหน่อย|"
    r"generate\s+an?\s+(image|picture|photo|illustration|logo|thumbnail|cover)|"
    r"create\s+an?\s+(image|picture|photo|illustration|logo|thumbnail|cover)|"
    r"(image|picture|photo|illustration|logo)\s+of\b|draw\s+a\s+(picture|photo|cat|dog|car|house|logo)|"
    r"make\s+(me\s+)?a\s+(picture|photo|logo|cat|dog|car|house)\b|"
    r"ภาพแมว|รูปแมว|ภาพสุนัข|รูปสุนัข|image\s+of\s+a\s+cat|picture\s+of\s+a\s+dog)"
)
_IMAGE_INTENT_RE = re.compile(_IMAGE_INTENT_KEYWORDS, re.IGNORECASE)


def _text_only_messages(messages: list) -> list:
    """Strip image parts from messages so only text remains.

    The image-tool loop only needs the text prompt; re-sending base64 images
    (from history) to the LLM bloats the context and trips the model's
    max-context-length limit.
    """
    out: list = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text_parts = [p for p in content if isinstance(p, dict) and p.get("type") == "text"]
            msg = {**msg, "content": text_parts if text_parts else ""}
        out.append(msg)
    return out


def _last_user_text(messages: list) -> str:
    """Return the plain text of the last user message (Anthropic/OpenAI shape)."""
    for msg in reversed(messages or []):
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role not in ("user",):
            continue
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                p.get("text", "") if isinstance(p, dict) else ""
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            return " ".join(parts).strip()
    return ""


def _wants_image(body: dict) -> bool:
    """Detect whether the last user turn asks to create an image."""
    text = _last_user_text(body.get("messages") or [])
    return bool(text) and bool(_IMAGE_INTENT_RE.search(text))


_IMAGE_INTENT_CLASSIFIER_TIMEOUT = 15
_IMAGE_INTENT_CLASSIFIER_PROMPT = (
    "You are a binary classifier for a chat application. Given the conversation "
    "transcript, decide whether the user wants you to CREATE, GENERATE, or DRAW a "
    "NEW image in this turn. Use the WHOLE conversation for context: a follow-up "
    "like 'make it a cat instead', 'show me' or 'now draw something funny' still "
    "counts as wanting an image when the recent topic was image creation. Asking "
    "questions about an existing image, discussing images in general, or saying an "
    "image should NOT be created are all false. "
    'Respond with ONLY a JSON object in this exact shape: {"wants_image": true} '
    'or {"wants_image": false}.'
)


def _parse_wants_image(content: str) -> bool | None:
    """Parse the classifier's JSON reply into a bool; None if unparseable."""
    if not content:
        return None
    fence = re.search(r"```(?:json)?\s*(.*?)```", content, re.DOTALL)
    if fence:
        content = fence.group(1).strip()
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(content[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    value = data.get("wants_image")
    return value if isinstance(value, bool) else None


async def _classify_image_intent(messages: list) -> bool | None:
    if isinstance(messages, list) and len(messages) > 0:
        # Early-exit if no image-related keywords in last 10 messages
        recent = messages[-10:] if len(messages) > 10 else messages
        joined = " ".join(_log_message_text(m.get("content")) for m in recent if isinstance(m, dict))
        if joined and not re.search(r"(image|picture|photo|illustration|logo|thumbnail|cover|รูป|ภาพ|วาด|สร้าง|draw|generate|create|make)", joined, re.IGNORECASE):
            return False
    if not isinstance(messages, list):
        messages = []
    window = messages[-40:] if len(messages) > 40 else messages
    history = []
    for m in window:
        if not isinstance(m, dict):
            continue
        text = _log_message_text(m.get("content"))
        if text:
            history.append(f"{m.get('role', 'user')}: {text}")
    transcript = "\n".join(history) if history else "(empty conversation)"

    if settings.deepseek_api_key:
        url = f"{settings.deepseek_url}/chat/completions"
        headers = _deepseek_headers()
        model = "deepseek-v4-pro"
    elif settings.gemini_api_key:
        url = f"{settings.gemini_url}/openai/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.gemini_api_key}",
        }
        model = settings.gemini_model
    else:
        return None

    classifier_messages = [
        {"role": "system", "content": _IMAGE_INTENT_CLASSIFIER_PROMPT},
        {"role": "user", "content": f"<conversation>\n{transcript}\n</conversation>"},
    ]
    # Some providers reject response_format; retry without it on the same inputs.
    attempts = [
        {
            "model": model,
            "messages": classifier_messages,
            "temperature": 0.0,
            "max_tokens": 32,
            "stream": False,
            "response_format": {"type": "json_object"},
        },
        {
            "model": model,
            "messages": classifier_messages,
            "temperature": 0.0,
            "max_tokens": 32,
            "stream": False,
        },
    ]

    async with httpx.AsyncClient(timeout=_IMAGE_INTENT_CLASSIFIER_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        for attempt in attempts:
            try:
                resp = await client.post(url, json=attempt, headers=headers)
            except httpx.HTTPError:
                continue
            if resp.status_code >= 400:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            verdict = _parse_wants_image(content)
            if verdict is not None:
                return verdict
    return None


async def _detect_image_intent(messages: list) -> bool:
    """Context-aware image-intent gate used before the image tool loop.

    Prefers the LLM's judgement over the whole conversation and falls back to the
    keyword heuristic whenever the classifier is unavailable or errors.
    """
    verdict = await _classify_image_intent(messages)
    if verdict is not None:
        return verdict
    return _wants_image({"messages": messages})


def _image_data_uri(prompt: str, model: str, size: str) -> str:
    seed_text = f"{prompt}|{model}|{size}"
    return "data:image/svg+xml;base64," + _mock_image_b64(prompt, model, size, seed_text)


_IMAGE_FETCH_TIMEOUT = 20
_IMAGE_GEN_TIMEOUT = 120
_UNSPLASH_SEARCH_API = "https://api.unsplash.com/search/photos"
_LOREM_FLICKR_API = "https://loremflickr.com/{width}/{height}/{tags}"
_DASHSCOPE_IMAGE_URL = (
    "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
)


def _parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = (int(x) for x in size.split("x")[:2])
    except (ValueError, AttributeError):
        w, h = 1024, 1024
    return w, h


async def _download_image_bytes(url: str) -> tuple[bytes, str]:
    """Download an image and return (bytes, content_type)."""
    async with httpx.AsyncClient(timeout=_IMAGE_FETCH_TIMEOUT, follow_redirects=True, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        return resp.content, ctype


async def _unsplash_url(query: str, seed_text: str, size: str = "1024x1024") -> str:
    """Pick a photo from Unsplash Search API, seeded for determinism.

    Returns the dynamic (raw) URL sized with `w`/`h`/`fit=crop` so the image
    matches the requested dimensions exactly.
    """
    if not settings.unsplash_access_key:
        raise RuntimeError("UNSPLASH_ACCESS_KEY not configured")
    w, h = _parse_size(size)
    params = {
        "query": query or "nature",
        "page": (_image_seed(seed_text) % 20) + 1,
        "per_page": 1,
    }
    headers = {"Authorization": f"Client-ID {settings.unsplash_access_key}"}
    async with httpx.AsyncClient(timeout=_IMAGE_FETCH_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.get(_UNSPLASH_SEARCH_API, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    photo = (data.get("results") or [{}])[0]
    base = (photo.get("urls") or {}).get("raw")
    if not base:
        raise RuntimeError("Unsplash returned no photo for the prompt")
    base = base.split("?")[0]  # drop ixlib etc., we control the params
    return f"{base}?w={w}&h={h}&fit=crop&q=80&fm=jpg&dpr=1"


def _loremflickr_url(query: str, size: str, seed_text: str) -> str:
    """No-key deterministic URL from loremflickr (Flickr tags = latin words)."""
    w, h = _parse_size(size)
    words = re.findall(r"[a-zA-Z0-9]+", query or "")
    if not words:
        words = ["nature"]
    tags = "-".join(words[:5])
    return _LOREM_FLICKR_API.format(width=w, height=h, tags=tags) + f"?lock={_image_seed(seed_text) % 100000}"


def _dashscope_image_size(size: str) -> str:
    """Convert '1024x1024' to DashScope's '1024*1024' format."""
    w, h = _parse_size(size)
    return f"{w}*{h}"


async def _dashscope_image(prompt: str, size: str) -> dict:
    """Generate an image with DashScope z-image-turbo (real AI generation).

    Calls the multimodal-generation API, downloads the returned image, and
    returns {"ref": <data uri>, "kind": "data_uri"} so the rest of the gateway
    (markdown embedding, b64 output, etc.) works unchanged.

    The image is downloaded into a data URI instead of returning the temporary
    OSS URL because those URLs are short-lived and would break saved chats.
    """
    if not settings.dashscope_api_key:
        raise RuntimeError("DASHSCOPE_API_KEY not configured")

    body = {
        "model": "z-image-turbo",
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt or "A beautiful scene"}],
                }
            ]
        },
        "parameters": {
            "prompt_extend": False,
            "size": _dashscope_image_size(size),
        },
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.dashscope_api_key}",
    }

    async with httpx.AsyncClient(timeout=_IMAGE_GEN_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(_DASHSCOPE_IMAGE_URL, json=body, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"DashScope image API error ({resp.status_code}): {resp.text[:300]}"
            )
        data = resp.json()

    # Response: output.choices[0].message.content = [{image: <url>, text: ...}, ...]
    choices = (data.get("output") or {}).get("choices") or []
    content = (choices[0].get("message") or {}).get("content") or [] if choices else []
    image_url = None
    for part in content:
        if isinstance(part, dict) and part.get("image"):
            image_url = part["image"]
            break
    if not image_url:
        raise RuntimeError("DashScope returned no image")

    raw, ctype = await _download_image_bytes(image_url)
    mime = ctype if ctype.startswith("image/") else "image/jpeg"
    try:
        from backend.storage.r2 import upload_bytes, is_configured
        if is_configured():
            url = upload_bytes(raw, mime, prefix="images/generated")
            if url:
                return {"ref": url, "kind": "url"}
    except Exception as e:
        print(f"[r2] dashscope upload fallback: {e}")
    return {"ref": f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}", "kind": "data_uri"}


async def _image_source(prompt: str, model: str, size: str, seed_text: str) -> dict:
    """Resolve the best available image source for `prompt`.

    Returns {"ref": <https url or data uri>, "kind": "url" | "data_uri"}.
    Provider order (settings.image_provider):
      - "dashscope": real AI generation via z-image-turbo (needs DASHSCOPE_API_KEY)
      - "unsplash": Unsplash Search API (needs UNSPLASH_ACCESS_KEY)
      - "loremflickr": free keyword API, no key required
      - "auto": try dashscope -> unsplash -> loremflickr -> mock
      - "mock" (default): deterministic offline SVG, no network
    Any provider failure falls through to the next candidate, ending at mock.
    """
    provider = (settings.image_provider or "mock").strip().lower()
    if provider == "auto":
        candidates = ("dashscope", "unsplash", "loremflickr", "mock")
    elif provider == "dashscope":
        candidates = ("dashscope", "mock")
    elif provider in ("unsplash", "loremflickr"):
        candidates = (provider, "mock")
    else:
        candidates = ("mock",)

    for candidate in candidates:
        if candidate == "dashscope":
            if not settings.dashscope_api_key:
                print("  [image] dashscope selected but DASHSCOPE_API_KEY is unset")
            else:
                try:
                    ref = await _dashscope_image(prompt, size)
                    print(f"  [image] dashscope z-image-turbo: {size}")
                    return ref
                except Exception as e:
                    print(f"  [image] dashscope failed ({type(e).__name__}: {e})")
        elif candidate == "unsplash":
            if not settings.unsplash_access_key:
                print("  [image] unsplash selected but UNSPLASH_ACCESS_KEY is unset")
            else:
                try:
                    url = await _unsplash_url(prompt, seed_text, size)
                    print(f"  [image] unsplash: {url}")
                    return {"ref": url, "kind": "url"}
                except Exception as e:
                    print(f"  [image] unsplash failed ({type(e).__name__}: {e})")
        elif candidate == "loremflickr":
            try:
                url = _loremflickr_url(query=prompt, size=size, seed_text=seed_text)
                print(f"  [image] loremflickr: {url}")
                return {"ref": url, "kind": "url"}
            except Exception as e:
                print(f"  [image] loremflickr failed ({type(e).__name__}: {e})")

    return {"ref": _image_data_uri(prompt, model, size), "kind": "data_uri"}


def _parse_image_toolcall(content: str) -> dict | None:
    """Extract the {content, tool_call, size} envelope from a model reply.

    The model is told to reply with a bare JSON object, but we tolerate markdown
    code fences or short prose wrapped around it.
    """
    if not content:
        return None
    text = content.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    tool_call = data.get("tool_call")
    if not isinstance(tool_call, str) or tool_call != "image_gen":
        return None
    content_val = data.get("content")
    if not isinstance(content_val, str) or not content_val.strip():
        return None
    return {
        "content": content_val.strip(),
        "tool_call": tool_call,
        "size": data.get("size") or "1024x1024",
    }


def _stream_image_markdown(final_text: str, data_uri: str, created_time: int, model: str):
    """Replay a fixed image-tool answer as a normal chat-completion SSE stream.

    The prose is streamed character-by-character for a natural typing effect,
    but the (potentially huge) base64 image is emitted as a single delta chunk —
    streaming it char-by-char would generate ~1.7M chunks for a 1.6MB data URI
    and effectively hang the client.
    """
    completion_id = f"chatcmpl-img-{created_time}"
    body_text = (final_text or "").strip()
    if not body_text:
        body_text = "สร้างรูปให้แล้วครับ"
    image_markdown = f"![generated image]({data_uri})"
    if data_uri not in body_text:
        body_text = body_text + f"\n\n{image_markdown}"
    full_text = body_text

    # Split text into the part before the image, the image markdown, and any tail.
    idx = full_text.find(image_markdown)
    if idx == -1:
        text_part, img_part, tail = full_text, "", ""
    else:
        text_part = full_text[:idx]
        img_part = image_markdown
        tail = full_text[idx + len(image_markdown):]

    async def streaming_response():
        first_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": model,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(first_chunk)}\n\n"
        await asyncio.sleep(0.05)

        for char in text_part:
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": char}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.01)

        # Emit the whole image markdown in one delta (not char-by-char).
        if img_part:
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": img_part}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"

        for char in tail:
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": char}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.01)

        final_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": len(text_part) + len(tail) + 1,
                "total_tokens": 10 + len(text_part) + len(tail) + 1,
            },
        }
        yield f"data: {json.dumps(final_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return streaming_response()


def _json_image_completion(final_text: str, data_uri: str, created_time: int, model: str) -> dict:
    body_text = (final_text or "").strip()
    if not body_text:
        body_text = "สร้างรูปให้แล้วครับ"
    if data_uri not in body_text:
        body_text = body_text + f"\n\n![generated image]({data_uri})"
    return {
        "id": f"chatcmpl-img-{created_time}",
        "object": "chat.completion",
        "created": created_time,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": body_text},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": len(body_text),
            "total_tokens": 10 + len(body_text),
        },
    }


async def _proxy_image_tool_loop(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """DeepSeek tool-call `create_image`, gateway executes it, round 2 composes the answer.

    Runs the loop non-streaming internally, then replays the final text as a normal
    SSE stream (if requested) so the client never sees tool-call machinery.
    """
    created_time = int(time.time())
    last_text = _last_user_text(body.get("messages") or [])

    # Enforce the per-tier monthly image quota before generating.
    await _check_image_quota(db, user_id)

    # If no DeepSeek key, generate straight from the prompt (offline demo still works).
    if not settings.deepseek_api_key:
        prompt = last_text.strip()
        image_ref = await _image_source(prompt, model, "1024x1024", f"{prompt}|{model}|1024x1024")
        final_text = "สร้างรูปให้แล้วครับ (mock)"
        await _log_image_usage(db, user_id, model)
        if is_stream:
            return StreamingResponse(
                _stream_image_markdown(final_text, image_ref["ref"], created_time, model),
                media_type="text/event-stream",
            )
        return JSONResponse(
            content=_json_image_completion(final_text, image_ref["ref"], created_time, model),
            status_code=200,
        )

    url = f"{settings.deepseek_url}/chat/completions"
    headers = _deepseek_headers()

    async def _post(payload: dict) -> tuple[int, dict]:
        # Try JSON-mode first if the provider supports response_format, then fall
        # back to a plain call (some models/proxies reject response_format).
        attempts = [dict(payload), dict(payload)]
        attempts[0].setdefault("response_format", {"type": "json_object"})
        last = (0, {"error": {"message": "no attempt"}})
        for attempt in attempts:
            async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                resp = await client.post(url, json=attempt, headers=headers)
                try:
                    data = resp.json()
                except Exception:
                    data = {"error": {"message": resp.text[:500]}}
                last = (resp.status_code, data)
                if resp.status_code < 400:
                    break
        return last

    # Round 1: ask the model to return a JSON envelope (content + tool_call) instead
    # of relying on native function calling, which some providers reject.
    round1_body = dict(body)
    round1_body["stream"] = False
    round1_body.pop("tools", None)
    round1_body.pop("tool_choice", None)
    round1_body.pop("response_format", None)
    # The optimizer/compose rounds always run against DeepSeek, so send a model
    # DeepSeek understands. Claude aliases resolve to deepseek; qwen/stealth/
    # gemini/image models fall back to the default deepseek model — this lets
    # image gen work no matter which model the client requested.
    engine_model = _image_engine_model(model)
    round1_body["model"] = engine_model
    round1_body["messages"] = _text_only_messages(round1_body.get("messages") or [])
    if isinstance(round1_body.get("messages"), list):
        optimizer_prompt = {
            "role": "system",
            "content": (
                "You can generate images. When the user wants you to generate an image, "
                "optimize the prompt and return JSON with 'content', 'tool_call', and 'size'. "
                "You are the image-prompt optimizer for a text-to-image generator. "
                "The user has asked to create an image. Respond with a SINGLE JSON "
                "object and nothing else — no markdown, no prose, no code fences. "
                "The JSON must have exactly this shape: "
                '{"content": "<optimized image prompt>", "tool_call": "image_gen", '
                '"size": "<size>"}. '
                "content: rewrite the user's request into ONE detailed, vivid English "
                "image prompt covering subject, scene, lighting, style (photorealistic, "
                "anime, watercolor, 3D render, ...), composition, and mood. "
                'tool_call: always the literal string "image_gen". '
                'size: one of "256x256", "512x512", "1024x1024", "1792x1024", '
                '"1024x1792" (square 1024x1024 unless the image is better wide or tall). '
                "The generated image will be shown back to you afterwards."
            ),
        }
        # Instruction must be a SYSTEM message placed FIRST. Appending it as a
        # trailing "user" turn makes the model treat it as the question to answer
        # instead of obeying it, so the real request gets ignored.
        round1_body["messages"] = [optimizer_prompt] + list(round1_body["messages"])

    status1, data1 = await _post(round1_body)
    if status1 >= 400:
        err = (data1.get("error") or {}).get("message", "DeepSeek error")
        if is_stream:
            async def err_stream():
                chunk = {
                    "id": f"chatcmpl-img-{created_time}",
                    "object": "chat.completion.chunk",
                    "created": created_time,
                    "model": model,
                    "choices": [{"index": 0, "delta": {"content": f"เกิดข้อผิดพลาด: {err}"}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(err_stream(), media_type="text/event-stream")
        return JSONResponse(
            content={"error": {"message": err, "type": "tool_loop", "code": status1}},
            status_code=200,
        )

    prompt_tokens_1 = (data1.get("usage") or {}).get("prompt_tokens", 0) or fallback_prompt_tokens
    completion_tokens_1 = (data1.get("usage") or {}).get("completion_tokens", 0)

    message1 = (data1.get("choices") or [{}])[0].get("message", {})
    raw_content = message1.get("content") or ""
    # Thinking-mode models often emit the JSON inside reasoning_content.
    reasoning = message1.get("reasoning_content") or ""
    print(f"  [image-tool] round1 content: {raw_content!r}")
    if reasoning:
        print(f"  [image-tool] round1 reasoning: {reasoning[:300]!r}")
    tool_result = _parse_image_toolcall(raw_content) or _parse_image_toolcall(reasoning)

    if not (tool_result and tool_result.get("tool_call") == "image_gen"):
        # Model did not produce the JSON envelope; fall back to the raw user text.
        print(f"  [image-tool] no image_gen envelope -> using raw prompt {last_text[:80]!r}")
        final_text = raw_content or "สร้างรูปให้แล้วครับ"
        prompt = last_text.strip()
        image_ref = await _image_source(prompt, model, "1024x1024", f"{prompt}|{model}|1024x1024")
        if is_stream:
            return StreamingResponse(
                _stream_image_markdown(final_text, image_ref["ref"], created_time, model),
                media_type="text/event-stream",
            )
        return JSONResponse(
            content=_json_image_completion(final_text, image_ref["ref"], created_time, model),
            status_code=200,
        )

    # Execute the tool with the optimized prompt the model produced.
    prompt = str(tool_result.get("content") or last_text).strip()
    size = str(tool_result.get("size") or "1024x1024")
    image_ref = await _image_source(prompt, model, size, f"{prompt}|{model}|{size}")

    # Round 2: give the model the tool result and let it compose the final answer.
    round2_messages = _text_only_messages(body.get("messages") or []) + [
        {
            "role": "assistant",
            "content": raw_content,
        },
        {
            "role": "user",
            "content": (
                f"The image was generated for you. Here is the image URL: {image_ref['ref']}\n"
                "Now reply to the user in their language with a short confirmation. "
                "Include the image in your reply as a markdown image: "
                f"![generated image]({image_ref['ref']}). Keep it brief."
            ),
        },
    ]
    round2_body = dict(body)
    round2_body["stream"] = False
    round2_body.pop("tools", None)
    round2_body.pop("tool_choice", None)
    round2_body.pop("response_format", None)
    round2_body["model"] = engine_model
    round2_body["messages"] = round2_messages

    status2, data2 = await _post(round2_body)
    prompt_tokens = prompt_tokens_1
    completion_tokens = completion_tokens_1
    if status2 < 400:
        usage2 = data2.get("usage") or {}
        prompt_tokens = prompt_tokens or usage2.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = completion_tokens or usage2.get("completion_tokens", 0)
        final_text = ((data2.get("choices") or [{}])[0].get("message", {}).get("content")) or ""
    else:
        final_text = "สร้างรูปให้แล้วครับ"

    if not completion_tokens:
        completion_tokens = count_text_tokens(final_text or "")
    await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)
    await _log_image_usage(db, user_id, model)

    if is_stream:
        return StreamingResponse(
            _stream_image_markdown(final_text, image_ref["ref"], created_time, model),
            media_type="text/event-stream",
        )
    return JSONResponse(
        content=_json_image_completion(final_text, image_ref["ref"], created_time, model),
        status_code=200,
    )


# ---------------------------------------------------------------------------
# Web search tool loop (DuckDuckGo HTML, no API key; mock fallback)
# ---------------------------------------------------------------------------

_WEB_SEARCH_TIMEOUT = 15
_DDG_HTML_API = "https://html.duckduckgo.com/html/"
_DDG_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


def _html_unescape(text: str) -> str:
    from html import unescape

    return unescape(text or "")


def _clean_ddg_url(url: str) -> str:
    """Decode DuckDuckGo's redirect wrapper (`/l/?uddg=<encoded>`) to the real URL."""
    url = (url or "").strip()
    if "duckduckgo.com/l/" in url:
        m = re.search(r"[?&]uddg=([^&]+)", url)
        if m:
            try:
                url = unquote(m.group(1))
            except Exception:
                pass
    if url.startswith("//"):
        url = "https:" + url
    return url


def _parse_ddg_results(html_text: str, limit: int = 5) -> list[dict]:
    """Extract {title, url, snippet} from a DuckDuckGo HTML results page."""
    results: list[dict] = []
    blocks = re.findall(r'<div class="result\b.*?</div>\s*</div>', html_text, re.DOTALL)
    if not blocks:
        blocks = re.findall(r'<div class="web-result\b.*?</div>\s*</div>', html_text, re.DOTALL)
    for block in blocks:
        link = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not link:
            continue
        url = _clean_ddg_url(link.group(1))
        title = _html_unescape(_strip_html(link.group(2))).strip()
        snippet_m = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.DOTALL)
        snippet = _html_unescape(_strip_html(snippet_m.group(1))).strip() if snippet_m else ""
        if not title:
            continue
        results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= limit:
            break
    return results


async def _web_search(query: str, limit: int = 5) -> list[dict]:
    """Run a real web search against DuckDuckGo's HTML endpoint (no key needed)."""
    if not query:
        return []
    async with httpx.AsyncClient(timeout=_WEB_SEARCH_TIMEOUT, follow_redirects=True, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.get(_DDG_HTML_API, params={"q": query}, headers={"User-Agent": _DDG_UA})
        resp.raise_for_status()
    return _parse_ddg_results(resp.text, limit)


def _mock_web_results(query: str) -> list[dict]:
    q = (query or "search").strip()
    return [
        {
            "title": f"ผลการค้นหาจำลองสำหรับ \"{q}\"",
            "url": "https://duckduckgo.com/?q=" + q.replace(" ", "+"),
            "snippet": "Web search is running in mock mode — live results were unavailable.",
        },
    ]


def _format_results(results: list[dict], header: str = "") -> str:
    if not results:
        return "_ไม่พบผลลัพธ์_"
    lines: list[str] = []
    if header:
        lines.append(header)
        lines.append("")
    for i, r in enumerate(results, 1):
        title = (r.get("title") or "Untitled").strip()
        url = (r.get("url") or "").strip()
        snippet = (r.get("snippet") or "").strip()
        lines.append(f"{i}. [{title}]({url})" if url else f"{i}. {title}")
        if snippet:
            lines.append(f"   {snippet}")
    return "\n".join(lines)


def _stream_text(final_text: str, created_time: int, model: str, tag: str):
    """Replay a fixed text answer as a normal chat-completion SSE stream."""
    completion_id = f"chatcmpl-{tag}-{created_time}"
    full_text = (final_text or "").strip() or "ไม่พบผลลัพธ์"

    async def streaming_response():
        first_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": model,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(first_chunk)}\n\n"
        await asyncio.sleep(0.05)

        for char in full_text:
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": char}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.01)

        final_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": len(full_text),
                "total_tokens": 10 + len(full_text),
            },
        }
        yield f"data: {json.dumps(final_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return streaming_response()


def _json_text_completion(final_text: str, created_time: int, model: str, tag: str) -> dict:
    full_text = (final_text or "").strip() or "ไม่พบผลลัพธ์"
    return {
        "id": f"chatcmpl-{tag}-{created_time}",
        "object": "chat.completion",
        "created": created_time,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": full_text},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": len(full_text),
            "total_tokens": 10 + len(full_text),
        },
    }


async def _proxy_web_search_loop(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """Search the web for the user's latest question and synthesize an answer.

    Fetches DuckDuckGo results, then (when a DeepSeek key is configured) asks the
    model to compose a grounded answer with citations. Without a key it replays
    the raw results as a markdown list.
    """
    created_time = int(time.time())
    query = _last_user_text(body.get("messages") or []).strip()

    results: list[dict] = []
    try:
        results = await _web_search(query)
    except Exception as e:
        print(f"  [web-search] failed ({type(e).__name__}: {e})")
    if not results:
        results = _mock_web_results(query)

    if settings.deepseek_api_key:
        synth_messages = (body.get("messages") or []) + [
            {
                "role": "user",
                "content": (
                    "Web search results for the user's latest question:\n\n"
                    + _format_results(results)
                    + "\n\nAnswer the user's question in their language, citing sources "
                    "with markdown links. Base your answer only on the search results above. "
                    "Keep it concise."
                ),
            }
        ]
        synth_body = dict(body)
        synth_body["stream"] = False
        synth_body.pop("tools", None)
        synth_body.pop("tool_choice", None)
        synth_body.pop("response_format", None)
        synth_body.pop("image_gen", None)
        synth_body.pop("web_search", None)
        synth_body["messages"] = synth_messages

        url = f"{settings.deepseek_url}/chat/completions"
        async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
            resp = await client.post(url, json=synth_body, headers=_deepseek_headers())
        if resp.status_code < 400:
            data = resp.json()
            final_text = ((data.get("choices") or [{}])[0].get("message", {}).get("content")) or ""
            usage = data.get("usage") or {}
            prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
            completion_tokens = usage.get("completion_tokens", 0) or count_text_tokens(final_text)
            await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)
            if is_stream:
                return StreamingResponse(
                    _stream_text(final_text, created_time, model, "search"),
                    media_type="text/event-stream",
                )
            return JSONResponse(
                content=_json_text_completion(final_text, created_time, model, "search"),
                status_code=200,
            )

    final_text = _format_results(results, header="ผลการค้นหา (web search):")
    await _log_usage(db, user_id, model, fallback_prompt_tokens, count_text_tokens(final_text))
    if is_stream:
        return StreamingResponse(
            _stream_text(final_text, created_time, model, "search"),
            media_type="text/event-stream",
        )
    return JSONResponse(
        content=_json_text_completion(final_text, created_time, model, "search"),
        status_code=200,
    )


@router.post("/v1/chat/completions")
@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    return await _handle_chat_completions(db, user_id, body)


@router.post("/api/web/chat/completions")
async def web_chat_completions(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Web-only chat. Uses a session token (any logged-in user), never an API key,
    so it stays fully separate from the member-gated OpenAI-compatible API."""
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    return await _handle_chat_completions(db, user_id, body)


async def _handle_chat_completions(db: AsyncSession, user_id: str, body: dict):
    model = await _free_model_gate(db, user_id, body)
    is_stream = body.get("stream", False)
    fallback_prompt_tokens = count_messages_tokens(body.get("messages") or [])
    created_time = int(time.time())

    _apply_max_tokens(body, model)

    # Custom gateway flags — pop them so they never reach an upstream provider.
    image_gen = bool(body.get("image_gen"))
    web_search = bool(body.get("web_search"))
    body.pop("image_gen", None)
    body.pop("web_search", None)

    # Media routing: qwen3.7-flash & glm-5.3-flash support [text,image,video],
    # deepseek-v4-flash-vision-exp supports [text,image] only.
    has_image = _has_image_content(body)
    has_video = _has_video_content(body)
    if has_image or has_video:
        if model == "deepseek-v4-flash-vision-exp":
            if has_video:
                raise HTTPException(
                    status_code=400,
                    detail="deepseek-v4-flash-vision-exp supports [text,image] only — use qwen3.7-flash or glm-5.3-flash for video.",
                )
            if not settings.deepseek_api_key:
                raise HTTPException(
                    status_code=503,
                    detail="deepseek-v4-flash-vision-exp requires DEEPSEEK_API_KEY.",
                )
            resp = await _proxy_to_deepseek(db, user_id, model, body, is_stream, fallback_prompt_tokens)
            return _with_log(resp, user_id, model, body.get("messages", []))
        if _supports_native_vision(model):
            pass
        else:
            if not settings.gemini_api_key:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Vision is not configured on this gateway. "
                        "Set GEMINI_API_KEY in the server environment to enable image/video chat."
                    ),
                )
            resp = await _proxy_to_gemini(db, user_id, body, is_stream, fallback_prompt_tokens)
            return _with_log(resp, user_id, model, body.get("messages", []))

    # If the user explicitly toggled image gen, selected an image-only model
    # (z-image-turbo etc.), or (in context) asks to create an image,
    # let DeepSeek tool-call our image tool.
    _IMAGE_ONLY_MODELS = {"z-image-turbo", "gpt-image-1", "dall-e-3", "gemini-2.0-flash-preview-image-generation"}
    if model and model.lower() in _IMAGE_ONLY_MODELS:
        image_gen = True
    if image_gen or await _detect_image_intent(body.get("messages") or []):
        print(f"  [image-intent] -> tool loop (prompt: {_last_user_text(body.get('messages') or [])[:100]!r})")
        resp = await _proxy_image_tool_loop(db, user_id, model, body, is_stream, fallback_prompt_tokens)
        return _with_log(resp, user_id, model, body.get("messages", []))

    # If web search is toggled on, run the search tool loop.
    if web_search:
        print(f"  [web-search] -> tool loop (query: {_last_user_text(body.get('messages') or [])[:100]!r})")
        resp = await _proxy_web_search_loop(db, user_id, model, body, is_stream, fallback_prompt_tokens)
        return _with_log(resp, user_id, model, body.get("messages", []))

    # Qwen models route to Alibaba Cloud DashScope (OpenAI-compatible mode).
    if model.lower().startswith("qwen"):
        if not settings.dashscope_api_key:
            raise HTTPException(
                status_code=503,
                detail="Qwen models require DASHSCOPE_API_KEY. Set it in the server environment.",
            )
        resp = await _proxy_to_dashscope(db, user_id, model, body, is_stream, fallback_prompt_tokens)
        return _with_log(resp, user_id, model, body.get("messages", []))

    if model.lower().startswith("glm-") or model.lower() == "stealth/ox-alpha":
        if not settings.z_api_key:
            raise HTTPException(
                status_code=503,
                detail="glm-5.3-flash requires Z_API_KEY. Set it in the server environment.",
            )
        resp = await _proxy_to_zai(db, user_id, model, body, is_stream, fallback_prompt_tokens)
        return _with_log(resp, user_id, model, body.get("messages", []))

    # If a DeepSeek key is configured, proxy to the real DeepSeek API.
    if settings.deepseek_api_key:
        resp = await _proxy_to_deepseek(db, user_id, model, body, is_stream, fallback_prompt_tokens)
        return _with_log(resp, user_id, model, body.get("messages", []))

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

        return _with_log(
            StreamingResponse(streaming_response(), media_type="text/event-stream"),
            user_id,
            model,
            body.get("messages", []),
        )

    else:
        await asyncio.sleep(0.5)
        mock_payload = _mock_payload(model, completion_id, created_time)
        await _log_usage(db, user_id, model, 15, len(MOCK_TEXT))
        return _with_log(
            JSONResponse(content=mock_payload, status_code=200),
            user_id,
            model,
            body.get("messages", []),
        )


# ---------------------------------------------------------------------------
# Mock image generation (placeholder SVG, no upstream API required)
# ---------------------------------------------------------------------------

_IMAGE_PALETTES = [
    ("#6366f1", "#a855f7", "#f0abfc"),  # indigo -> fuchsia
    ("#0ea5e9", "#22d3ee", "#99f6e4"),  # sky -> teal
    ("#f59e0b", "#ef4444", "#fb923c"),  # amber -> red
    ("#10b981", "#22c55e", "#bef264"),  # emerald -> lime
    ("#3b82f6", "#8b5cf6", "#c4b5fd"),  # blue -> violet
]


def _image_seed(seed_text: str) -> int:
    return int(hashlib.md5(seed_text.encode("utf-8")).hexdigest()[:8], 16)


def _mock_image_svg(prompt: str, model: str, size: str, seed_text: str) -> str:
    """Return an SVG placeholder derived deterministically from the prompt."""
    seed = _image_seed(seed_text)
    palette = _IMAGE_PALETTES[seed % len(_IMAGE_PALETTES)]
    angle = seed % 360
    c1, c2, c3 = palette

    if size == "1024x1024":
        w, h = 1024, 1024
    elif size == "512x512":
        w, h = 512, 512
    elif size == "256x256":
        w, h = 256, 256
    elif size == "1792x1024":
        w, h = 1792, 1024
    elif size == "1024x1792":
        w, h = 1024, 1792
    else:
        try:
            w, h = (int(x) for x in size.split("x")[:2])
        except (ValueError, AttributeError):
            w, h = 1024, 1024

    r1, r2 = w // 4, h // 4
    cx = (seed % (w - r2)) + r2
    cy = (seed * 3 % (h - r2)) + r2

    title = ""
    lines: list[str] = []
    if prompt:
        from html import escape as _esc

        words = _esc(prompt[:200]).split()
        while words:
            line, words = " ".join(words[:8]), words[8:]
            lines.append(line)
        tspans = "<tspan x=\"50%\" dy=\"0\">" + "</tspan><tspan x=\"50%\" dy=\"1.35em\">".join(lines) + "</tspan>"
        title = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="system-ui, sans-serif" font-size="' + str(max(28, w // 40)) + '" font-weight="700" opacity="0.95">' + tspans + "</text>"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}" />
      <stop offset="55%" stop-color="{c2}" />
      <stop offset="100%" stop-color="{c3}" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="white" stop-opacity="0.35" />
      <stop offset="100%" stop-color="white" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <circle cx="{cx}" cy="{cy}" r="{r1}" fill="white" opacity="0.12" />
  <circle cx="{w - cx}" cy="{h - cy}" r="{r2}" fill="white" opacity="0.10" />
  <rect width="100%" height="100%" fill="url(#glow)" />
  <text x="32" y="{h - 48}" fill="white" opacity="0.6" font-family="monospace, monospace" font-size="{max(20, w // 64)}">mock :: {model} :: {size}</text>
  {title}
</svg>"""


def _mock_image_b64(prompt: str, model: str, size: str, seed_text: str) -> str:
    svg = _mock_image_svg(prompt, model, size, seed_text).encode("utf-8")
    return base64.b64encode(svg).decode("ascii")


@router.post("/v1/images/generations")
@router.post("/images/generations")
async def image_generations(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    """OpenAI-compatible image generation. Returns a deterministic placeholder
    when no upstream image API is configured (mock mode), so clients that call
    /v1/images/generations always get a usable image response."""
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    model = body.get("model", "dall-e-3")
    prompt = str(body.get("prompt") or "").strip()
    n = int(body.get("n", 1))
    size = str(body.get("size") or "1024x1024")
    response_format = str(body.get("response_format") or "url")
    out_format = response_format if response_format in ("url", "b64_json") else "url"

    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    if n < 1 or n > 10:
        raise HTTPException(status_code=400, detail="n must be between 1 and 10")

    # Enforce the per-tier monthly image quota.
    quota, used = await _image_quota_for_user(db, user_id)
    count = min(n, 4)
    if quota <= 0:
        raise HTTPException(
            status_code=403,
            detail="Image generation is not included in your plan. Upgrade to generate images.",
        )
    if used + count > quota:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Monthly image quota would be exceeded ({used}/{quota} used, "
                f"requesting {count}). Upgrade to a higher tier for more images."
            ),
        )

    created_time = int(time.time())
    refs = []
    for i in range(count):
        seed_text = f"{prompt}|{model}|{size}|{i}"
        refs.append((seed_text, await _image_source(prompt, model, size, seed_text)))

    data = []
    for seed_text, ref in refs:
        if out_format == "b64_json":
            if ref["kind"] == "url":
                try:
                    raw, _ctype = await _download_image_bytes(ref["ref"])
                    data.append({"b64_json": base64.b64encode(raw).decode("ascii")})
                    continue
                except Exception as e:
                    print(f"  [image] download failed ({type(e).__name__}: {e}) -> mock b64")
            data.append({"b64_json": _mock_image_b64(prompt, model, size, seed_text)})
        else:
            data.append({"url": ref["ref"]})
    data[0]["revised_prompt"] = prompt

    await _log_usage(db, user_id, model, len(prompt.split()), 0)
    for _ in range(count):
        await _log_image_usage(db, user_id, model)
    return JSONResponse(
        content={"created": created_time, "data": data},
        status_code=200,
    )


@router.post("/v1/responses")
@router.post("/responses")
async def responses_api(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    model = await _free_model_gate(db, user_id, body)
    _apply_max_output_tokens(body, model)
    is_stream = body.get("stream", False)
    fallback_prompt_tokens = count_responses_input_tokens(body.get("input") or "")

    has_image = _responses_has_image(body.get("input"))
    has_video = _responses_has_video(body.get("input"))
    if has_image or has_video:
        if model == "deepseek-v4-flash-vision-exp":
            if has_video:
                raise HTTPException(status_code=400, detail="deepseek-v4-flash-vision-exp supports [text,image] only — use qwen3.7-flash or glm-5.3-flash for video.")
        elif _supports_native_vision(model):
            pass
        else:
            if not settings.gemini_api_key:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Vision is not configured on this gateway. "
                        "Set GEMINI_API_KEY in the server environment to enable image/video chat."
                    ),
                )
            return await _proxy_gemini_responses(db, user_id, body, is_stream, fallback_prompt_tokens)

    # Qwen models route to Alibaba Cloud DashScope Responses endpoint.
    if model.lower().startswith("qwen"):
        if not settings.dashscope_api_key:
            raise HTTPException(
                status_code=503,
                detail="Qwen models require DASHSCOPE_API_KEY. Set it in the server environment.",
            )
        return await _proxy_dashscope_responses(
            db, user_id, model, body, is_stream, fallback_prompt_tokens
        )

    if not settings.deepseek_api_key:
        raise HTTPException(status_code=503, detail="Responses API unavailable: no DeepSeek key configured")

    url = f"{settings.deepseek_url}/responses"
    headers = _deepseek_headers()

    if is_stream:
        async def deepseek_responses_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_event("error", {"type": "error", "code": "upstream_error", "message": f"⚠️ {model}: {msg}"}).encode()
                            yield _sse_event("response.output_text.delta", {"type": "response.output_text.delta", "delta": f"⚠️ {model}: {msg} — Please try again later.", "item_id": "msg_responses", "output_index": 0, "content_index": 0}).encode()
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _responses_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("input_tokens") or prompt_tokens
                                completion_tokens = usage.get("output_tokens") or completion_tokens
                            completion_text += _responses_text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(deepseek_responses_stream()), media_type="text/event-stream")

    else:
        async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
            resp = await client.post(url, json=body, headers=headers)
            data = resp.json()
            usage = data.get("usage") or {}
            prompt_tokens = usage.get("input_tokens", 0) or fallback_prompt_tokens
            completion_tokens = usage.get("output_tokens", 0)
            if not completion_tokens:
                completion_tokens = count_text_tokens(_responses_output_text(data))
            await _log_usage(
                db,
                user_id,
                model,
                prompt_tokens,
                completion_tokens,
            )
            return JSONResponse(content=data, status_code=resp.status_code)


CLAUDE_ALIAS_TO_MODEL = {
    "claude-sonnet-4-5": "deepseek-v4-pro",
    "claude-sonnet-4": "deepseek-v4-pro",
    "claude-3-5-sonnet": "deepseek-v4-pro",
    "claude-haiku-4-5": "deepseek-v4-flash",
    "claude-3-haiku": "deepseek-v4-flash",
    "claude-sonnet-4-20250514": "deepseek-v4-pro",
    "stealth/ox-alpha": "glm-5.3-flash",
}

def _resolve_model(model: str) -> str:
    """Map Anthropic/Claude model names sent by Claude Code to gateway models."""
    if not model:
        return "deepseek-v4-pro"
    return CLAUDE_ALIAS_TO_MODEL.get(model, model)


def _image_engine_model(model: str) -> str:
    """Map any requested model to a model DeepSeek can run for the image tool loop.

    Image generation always drives its optimizer/compose rounds through DeepSeek.
    Claude aliases already resolve to a deepseek model; qwen/stealth/gemini and the
    dedicated image models have no DeepSeek counterpart, so they fall back to the
    default deepseek-v4-pro. This keeps image gen working for every model id.
    """
    engine = _resolve_model(model)
    if (
        engine.lower().startswith("qwen")
        or engine.lower().startswith("glm-") or engine.lower() == "stealth/ox-alpha"
        or engine.startswith("gemini-")
        or engine in ("gpt-image-1", "dall-e-3", "gemini-2.0-flash-preview-image-generation")
    ):
        return "deepseek-v4-pro"
    return engine


def _anthropic_chat_payload(body: dict) -> dict:
    """Build an OpenAI chat-completions payload from an Anthropic Messages request."""
    messages = _anthropic_to_chat_messages(body)
    model = _resolve_model(body.get("model", "deepseek-v4-pro"))
    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": bool(body.get("stream", False)),
    }
    if body.get("max_tokens"):
        payload["max_tokens"] = body["max_tokens"]
        _apply_max_tokens(payload, model)
    if body.get("temperature") is not None:
        payload["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        payload["top_p"] = body["top_p"]
    if body.get("stop_sequences"):
        payload["stop"] = body["stop_sequences"]
    if body.get("tools"):
        payload["tools"] = _anthropic_tools_to_chat(body["tools"])
    tool_choice = _anthropic_tool_choice_to_chat(body.get("tool_choice"))
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice
    return payload


@router.post("/v1/messages")
@router.post("/messages")
async def anthropic_messages(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    """Anthropic Messages API compatible endpoint, proxied to DeepSeek/Gemini.

    Accepts Anthropic's request shape (system, messages with text/image blocks,
    tools, tool_choice, max_tokens, stream) and returns Anthropic-formatted
    JSON or SSE stream.
    """
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    model = _resolve_model(await _free_model_gate(db, user_id, body))
    is_stream = body.get("stream", False)
    payload = _anthropic_chat_payload(body)
    fallback_prompt_tokens = fallback_prompt_tokens_for(payload.get("messages") or [])
    has_image = _anthropic_has_image(body)
    has_video = _anthropic_has_video(body)
    if has_image or has_video:
        if model == "deepseek-v4-flash-vision-exp":
            if has_video:
                raise HTTPException(status_code=400, detail="deepseek-v4-flash-vision-exp supports [text,image] only — use qwen3.7-flash or glm-5.3-flash for video.")
        elif _supports_native_vision(model):
            pass
        else:
            if not settings.gemini_api_key:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Vision is not configured on this gateway. "
                        "Set GEMINI_API_KEY in the server environment to enable image/video chat."
                    ),
                )
            payload["model"] = settings.gemini_model
            url = f"{settings.gemini_url}/openai/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.gemini_api_key}",
            }
            upstream_model = settings.gemini_model
    elif settings.deepseek_api_key:
        url = f"{settings.deepseek_url}/chat/completions"
        headers = _deepseek_headers()
        upstream_model = model
    else:
        url = None
        headers = None
        upstream_model = model

    if url is None:
        # Mock fallback when no upstream key is configured.
        message_id = f"msg_{int(time.time())}"
        if is_stream:
            async def mock_anthropic_stream():
                meta = {
                    "message_id": message_id,
                    "model": upstream_model,
                    "output_text": [],
                    "tool_calls": [],
                    "block_started": False,
                }
                yield _sse_event(
                    "message_start",
                    {
                        "type": "message_start",
                        "message": {
                            "id": message_id,
                            "type": "message",
                            "role": "assistant",
                            "model": upstream_model,
                            "content": [],
                            "stop_reason": None,
                            "stop_sequence": None,
                            "usage": {"input_tokens": fallback_prompt_tokens, "output_tokens": 1},
                        },
                    },
                )
                yield _sse_event(
                    "content_block_start",
                    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                )
                for char in MOCK_TEXT:
                    meta["output_text"].append(char)
                    yield _sse_event(
                        "content_block_delta",
                        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": char}},
                    )
                    await asyncio.sleep(0.01)
                yield _emit_anthropic_message_stop(meta, "stop")
                await _log_usage(db, user_id, upstream_model, fallback_prompt_tokens, count_text_tokens(MOCK_TEXT))

            return StreamingResponse(mock_anthropic_stream(), media_type="text/event-stream")

        await asyncio.sleep(0.3)
        response = _build_anthropic_message(upstream_model, MOCK_TEXT, [], "stop")
        await _log_usage(
            db, user_id, upstream_model, fallback_prompt_tokens, count_text_tokens(MOCK_TEXT)
        )
        return JSONResponse(
            content={
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": upstream_model,
                "content": response["content"],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {
                    "input_tokens": fallback_prompt_tokens,
                    "output_tokens": count_text_tokens(MOCK_TEXT),
                },
            },
            status_code=200,
        )

    if is_stream:
        async def anthropic_stream():
            message_id = f"msg_{int(time.time())}"
            meta = {
                "message_id": message_id,
                "model": upstream_model,
                "output_text": [],
                "tool_calls": [],
                "block_started": False,
            }
            prompt_tokens = 0
            completion_tokens = 0
            finish_reason = None
            sent_stop = False
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_event("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
                            yield _sse_event("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": f"⚠️ {upstream_model}: {msg} — Please try again later."}})
                            yield _sse_event("content_block_stop", {"type": "content_block_stop", "index": 0})
                            yield _sse_event("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 1}})
                            yield _sse_event("message_stop", {"type": "message_stop"})
                            return
                        yield _sse_event(
                            "message_start",
                            {
                                "type": "message_start",
                                "message": {
                                    "id": message_id,
                                    "type": "message",
                                    "role": "assistant",
                                    "model": upstream_model,
                                    "content": [],
                                    "stop_reason": None,
                                    "stop_sequence": None,
                                    "usage": {"input_tokens": fallback_prompt_tokens, "output_tokens": 1},
                                },
                            },
                        )
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            for choice in _chat_choice_finish_from_chunk(chunk):
                                if choice is not None:
                                    finish_reason = choice
                            for event in _anthropic_chat_chunk_to_events(chunk, meta):
                                yield event
                if not sent_stop:
                    sent_stop = True
                    yield _emit_anthropic_message_stop(meta, finish_reason or "stop")
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens("".join(meta["output_text"]))
                await _log_usage(db, user_id, upstream_model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(anthropic_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=payload, headers=headers)
        data = resp.json()
        if resp.status_code >= 400:
            return JSONResponse(content=data, status_code=resp.status_code)

    usage = data.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
    completion_tokens = usage.get("completion_tokens", 0)
    message = (data.get("choices") or [{}])[0].get("message", {})
    content = message.get("content") or ""
    chat_tool_calls = []
    for tc in message.get("tool_calls") or []:
        fn = tc.get("function") or {}
        chat_tool_calls.append(
            {
                "id": tc.get("id", ""),
                "name": fn.get("name", ""),
                "arguments": fn.get("arguments", ""),
            }
        )
    finish_reason = (data.get("choices") or [{}])[0].get("finish_reason")
    if not completion_tokens:
        completion_tokens = count_text_tokens(content)
    message_id = f"msg_{int(time.time())}"
    response = _build_anthropic_message(upstream_model, content, chat_tool_calls, finish_reason)
    await _log_usage(db, user_id, upstream_model, prompt_tokens, completion_tokens)

    return JSONResponse(
        content={
            "id": message_id,
            "type": "message",
            "role": "assistant",
            "model": upstream_model,
            "content": response["content"],
            "stop_reason": response["stop_reason"],
            "stop_sequence": response["stop_sequence"],
            "usage": {
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
            },
        },
        status_code=200,
    )


def _chat_choice_finish_from_chunk(chunk: bytes) -> list:
    """Return finish_reason values found in a chat-completions SSE chunk."""
    out = []
    decoded = chunk.decode(errors="replace").strip()
    if not decoded.startswith("data: ") or decoded == "data: [DONE]":
        return out
    try:
        data = json.loads(decoded[6:])
    except json.JSONDecodeError:
        return out
    for choice in data.get("choices") or []:
        finish = choice.get("finish_reason")
        if finish is not None:
            out.append(finish)
    return out


async def _proxy_to_deepseek(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    url = f"{settings.deepseek_url}/chat/completions"
    headers = _deepseek_headers()

    if is_stream:
        async def deepseek_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_error_chunk(f"⚠️ {model}: {msg} — Please try again later.", model)
                            yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                            yield b'data: [DONE]\n\n'
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            completion_text += _text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(deepseek_stream()), media_type="text/event-stream")

    else:
        async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
            resp = await client.post(url, json=body, headers=headers)
            data = resp.json()
            usage = data.get("usage") or {}
            prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
            completion_tokens = usage.get("completion_tokens", 0)
            if not completion_tokens:
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
                completion_tokens = count_text_tokens(content)
            await _log_usage(
                db,
                user_id,
                model,
                prompt_tokens,
                completion_tokens,
            )
            return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_to_dashscope(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """Proxy a chat-completions request to Alibaba Cloud DashScope (Qwen).

    DashScope's OpenAI-compatible endpoint lives at
    {dashscope_url}/compatible-mode/v1/chat/completions and supports the same
    SSE streaming shape as OpenAI/DeepSeek, so the existing stream passthrough
    and usage parsing work unchanged.
    """
    url = f"{settings.dashscope_url}/compatible-mode/v1/chat/completions"
    headers = _dashscope_headers()

    if is_stream:
        async def dashscope_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_error_chunk(f"⚠️ {model}: {msg} — Please try again later.", model)
                            yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                            yield b'data: [DONE]\n\n'
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            completion_text += _text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(dashscope_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("completion_tokens", 0)
        if not completion_tokens:
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            completion_tokens = count_text_tokens(content)
        await _log_usage(
            db,
            user_id,
            model,
            prompt_tokens,
            completion_tokens,
        )
        return JSONResponse(content=data, status_code=resp.status_code)


def _openrouter_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": settings.dashboard_url,
        "X-Title": "Detroit LLM Gateway",
    }


def _zai_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.z_api_key}",
    }


def _openrouter_body(body: dict) -> dict:
    """Normalize a chat body for OpenRouter.

    OpenRouter reasoning models (stealth/ox-alpha) require reasoning and reject an
    explicit disable (e.g. `reasoning: {effort: "none"}`), so coerce a disabled
    reasoning into a valid enabled effort before forwarding.
    """
    body = dict(body)
    reasoning = body.get("reasoning") or {}
    disabled = (
        isinstance(reasoning, dict)
        and (reasoning.get("effort") == "none" or reasoning.get("enabled") is False)
    ) or body.get("reasoning_effort") == "none"
    if disabled:
        body["reasoning"] = {"effort": "high"}
        body.pop("reasoning_effort", None)
    return body


async def _proxy_to_openrouter(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """Proxy a chat-completions request to OpenRouter.

    OpenRouter exposes an OpenAI-compatible endpoint, so the existing stream
    passthrough + usage parsing work unchanged.
    """
    url = f"{settings.openrouter_url}/chat/completions"
    headers = _openrouter_headers()
    body = _openrouter_body(body)

    if is_stream:
        async def openrouter_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_error_chunk(f"⚠️ {model}: {msg} — Please try again later.", model)
                            yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                            yield b'data: [DONE]\n\n'
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            completion_text += _text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(openrouter_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("completion_tokens", 0)
        if not completion_tokens:
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            completion_tokens = count_text_tokens(content)
        await _log_usage(
            db,
            user_id,
            model,
            prompt_tokens,
            completion_tokens,
        )
        return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_to_zai(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    url = f"{settings.z_ai_url.rstrip('/')}/chat/completions"
    headers = _zai_headers()
    if is_stream:
        async def zai_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_error_chunk(f"⚠️ {model}: {msg} — Please try again later.", model)
                            yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                            yield b'data: [DONE]\n\n'
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            completion_text += _text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)
        return StreamingResponse(_deadline_wrapper(zai_stream()), media_type="text/event-stream")
    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("completion_tokens", 0)
        if not completion_tokens:
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            completion_tokens = count_text_tokens(content)
        await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)
        return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_dashscope_responses(
    db: AsyncSession,
    user_id: str,
    model: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """Proxy a Responses API request to DashScope's compatible-mode endpoint."""
    url = f"{settings.dashscope_url}/api/v2/apps/protocols/compatible-mode/v1/responses"
    headers = _dashscope_headers()

    if is_stream:
        async def dashscope_responses_stream():
            prompt_tokens = 0
            completion_tokens = 0
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_event("error", {"type": "error", "code": "upstream_error", "message": f"⚠️ {model}: {msg}"}).encode()
                            yield _sse_event("response.completed", {"type": "response.completed", "response": {"id": f"resp_{int(time.time())}", "object": "response", "status": "failed", "model": model, "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": f"⚠️ {model}: {msg} — Please try again later."}]}]}}).encode()
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _responses_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("input_tokens") or prompt_tokens
                                completion_tokens = usage.get("output_tokens") or completion_tokens
                            completion_text += _responses_text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(dashscope_responses_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("input_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("output_tokens", 0)
        if not completion_tokens:
            completion_tokens = count_text_tokens(_responses_output_text(data))
        await _log_usage(
            db,
            user_id,
            model,
            prompt_tokens,
            completion_tokens,
        )
        return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_to_gemini(
    db: AsyncSession,
    user_id: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    gemini_body = {k: v for k, v in body.items() if k not in GEMINI_STRIP_KEYS}
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
            completion_text = ""
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=gemini_body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            msg = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_error_chunk(f"⚠️ {settings.gemini_model}: {msg} — Please try again later.", settings.gemini_model)
                            yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                            yield b'data: [DONE]\n\n'
                            return
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            completion_text += _text_from_chunk(chunk)
                            yield chunk
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens(completion_text)
                await _log_usage(db, user_id, settings.gemini_model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(gemini_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=gemini_body, headers=headers)
        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("completion_tokens", 0)
        if not completion_tokens:
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            completion_tokens = count_text_tokens(content)
        await _log_usage(
            db,
            user_id,
            settings.gemini_model,
            prompt_tokens,
            completion_tokens,
        )
        return JSONResponse(content=data, status_code=resp.status_code)


async def _proxy_gemini_responses(
    db: AsyncSession,
    user_id: str,
    body: dict,
    is_stream: bool,
    fallback_prompt_tokens: int,
):
    """Proxy a vision-capable Responses API request to Gemini's chat-completions endpoint.

    Gemini's OpenAI-compatible API does not implement /responses, so the Responses
    `input` is converted to chat messages and the chat stream is translated back
    into Responses SSE events (response.created / response.output_text.delta /
    response.completed).
    """
    messages = _responses_to_chat_messages(body.get("input") or [])
    gemini_body: dict = {
        "model": settings.gemini_model,
        "messages": messages,
        "stream": bool(is_stream),
    }
    if body.get("tools"):
        gemini_body["tools"] = _responses_tools_to_chat_tools(body["tools"])
    if body.get("tool_choice") is not None:
        gemini_body["tool_choice"] = _responses_tool_choice_to_chat(body["tool_choice"])
    if body.get("temperature") is not None:
        gemini_body["temperature"] = body["temperature"]
    max_tokens = body.get("max_output_tokens") or body.get("max_tokens")
    if max_tokens:
        gemini_body["max_tokens"] = max_tokens

    url = f"{settings.gemini_url}/openai/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.gemini_api_key}",
    }
    responses_id = f"resp_{int(time.time())}"

    if is_stream:
        async def gemini_responses_stream():
            output_text: list = []
            tool_calls: list = []
            prompt_tokens = 0
            completion_tokens = 0
            created_time = int(time.time())
            try:
                async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                    async with client.stream("POST", url, json=gemini_body, headers=headers) as resp:
                        if resp.status_code >= 400:
                            error_body = await resp.aread()
                            detail = _extract_upstream_error_message(error_body, f"Upstream error {resp.status_code}")
                            yield _sse_event(
                                "error",
                                {
                                    "type": "error",
                                    "code": "gemini_upstream_error",
                                    "message": f"⚠️ {settings.gemini_model}: {detail} — Please try again later.",
                                },
                            )
                            yield _sse_event(
                                "response.output_text.delta",
                                {"type": "response.output_text.delta", "delta": f"⚠️ {settings.gemini_model}: {detail} — Please try again later.", "item_id": "msg_responses", "output_index": 0, "content_index": 0},
                            )
                            return
                        yield _sse_event(
                            "response.created",
                            {
                                "type": "response.created",
                                "response": {
                                    "id": responses_id,
                                    "object": "response",
                                    "created_at": created_time,
                                    "status": "in_progress",
                                    "model": settings.gemini_model,
                                    "output": [],
                                },
                            },
                        )
                        async for chunk in resp.aiter_bytes():
                            usage = _parse_usage_from_chunk(chunk)
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                                completion_tokens = usage.get("completion_tokens", completion_tokens)
                            for event, data in _chat_chunk_to_responses_events(chunk, output_text, tool_calls):
                                yield _sse_event(event, data)
                output = _build_responses_output("".join(output_text), tool_calls)
                yield _sse_event(
                    "response.completed",
                    {
                        "type": "response.completed",
                        "response": {
                            "id": responses_id,
                            "object": "response",
                            "created_at": created_time,
                            "status": "completed",
                            "model": settings.gemini_model,
                            "output": output,
                            "usage": {
                                "input_tokens": prompt_tokens or fallback_prompt_tokens,
                                "output_tokens": completion_tokens,
                                "total_tokens": (prompt_tokens or fallback_prompt_tokens) + completion_tokens,
                            },
                        },
                    },
                )
            finally:
                if not prompt_tokens:
                    prompt_tokens = fallback_prompt_tokens
                if not completion_tokens:
                    completion_tokens = count_text_tokens("".join(output_text))
                await _log_usage(db, user_id, settings.gemini_model, prompt_tokens, completion_tokens)

        return StreamingResponse(_deadline_wrapper(gemini_responses_stream()), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=gemini_body, headers=headers)
        data = resp.json()
        if resp.status_code >= 400:
            return JSONResponse(content=data, status_code=resp.status_code)
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens
        completion_tokens = usage.get("completion_tokens", 0)
        message = (data.get("choices") or [{}])[0].get("message", {})
        content = message.get("content") or ""
        chat_tool_calls = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            chat_tool_calls.append(
                {
                    "id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                }
            )
        if not completion_tokens:
            completion_tokens = count_text_tokens(content)
        output = _build_responses_output(content, chat_tool_calls)
        await _log_usage(db, user_id, settings.gemini_model, prompt_tokens, completion_tokens)
        return JSONResponse(
            content={
                "id": responses_id,
                "object": "response",
                "created_at": int(time.time()),
                "status": "completed",
                "model": settings.gemini_model,
                "output": output,
                "usage": {
                    "input_tokens": prompt_tokens,
                    "output_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                },
            },
            status_code=200,
        )


@router.post("/v1/messages/count_tokens")
@router.post("/messages/count_tokens")
async def anthropic_count_tokens(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    """Anthropic token-counting endpoint (used by Claude Code before requests)."""
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    messages = _anthropic_to_chat_messages(body)
    count = count_messages_tokens(messages)
    return JSONResponse(content={"input_tokens": count}, status_code=200)


@router.post("/v1/chat/compact")
@router.post("/chat/compact")
async def chat_compact(
    request: Request,
    user_id: str = Depends(require_access),
    db: AsyncSession = Depends(get_db),
):
    """Summarize the conversation history so a long chat can be compacted."""
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    return await _handle_chat_compact(db, user_id, body)


@router.post("/api/web/chat/compact")
async def web_chat_compact(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Web-only compaction (session token, any logged-in user)."""
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    return await _handle_chat_compact(db, user_id, body)


async def _handle_chat_compact(db: AsyncSession, user_id: str, body: dict):
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="'messages' must be a non-empty list")

    model = body.get("model", "deepseek-v4-pro")

    if not settings.deepseek_api_key:
        raise HTTPException(status_code=503, detail="Compaction unavailable: no DeepSeek key configured")

    # Flatten multimodal content to text before summarizing.
    flat_messages = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if isinstance(content, list):
            text_parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                    text_parts.append(part["text"])
                elif isinstance(part, dict) and (part.get("type") == "image_url" or "image_url" in part):
                    text_parts.append("[image]")
            content = "\n".join(text_parts) if text_parts else "[image]"
        flat_messages.append({"role": m.get("role", "user"), "content": str(content)})

    compact_payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a conversation compressor. Summarize the following chat conversation "
                    "into a concise summary that preserves all important facts, user intent, decisions, "
                    "code context, and open questions. Keep it under 500 words. Output only the summary."
                ),
            },
            *flat_messages,
        ],
        "temperature": 0.3,
        "max_tokens": 1024,
        "stream": False,
    }

    url = f"{settings.deepseek_url}/chat/completions"
    headers = _deepseek_headers()
    async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
        resp = await client.post(url, json=compact_payload, headers=headers)
        data = resp.json()
        if resp.status_code >= 400:
            return JSONResponse(content=data, status_code=resp.status_code)

    usage = data.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens", 0) or fallback_prompt_tokens_for(messages)
    completion_tokens = usage.get("completion_tokens", 0)
    summary = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if not completion_tokens:
        completion_tokens = count_text_tokens(summary)
    await _log_usage(db, user_id, model, prompt_tokens, completion_tokens)

    return JSONResponse(
        content={"summary": summary, "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens}},
        status_code=200,
    )


@router.get("/v1/models")
@router.get("/models")
async def list_models(request: Request, db: AsyncSession = Depends(get_db)):
    # Claude Code / Anthropic SDKs validate the requested model against this list.
    # Always advertise our gateway models (with claude-style aliases so the name
    # Claude Code sends is found) alongside whatever the upstream provides.
    #
    # A dashboard session token narrows the list to the models the signed-in
    # user may actually call (free tier = flash + glm-5.3-flash). API keys
    # and unauthenticated harness clients still get the full list.
    free_user = False
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            user_id = await require_session(request)
            free_user = await _is_free_user(db, user_id)
        except HTTPException:
            free_user = False
    gateway_models = [
        {
            "object": "model",
            "type": "model",
            "id": "deepseek-v4-pro",
            "display_name": "deepseek-v4-pro",
        },
        {
            "object": "model",
            "type": "model",
            "id": "deepseek-v4-flash",
            "display_name": "deepseek-v4-flash",
        },
        {
            "object": "model",
            "type": "model",
            "id": "deepseek-v4-flash-vision-exp",
            "display_name": "deepseek-v4-flash-vision-exp",
        },
        {
            "object": "model",
            "type": "model",
            "id": "claude-sonnet-4-5",
            "display_name": "claude-sonnet-4-5",
        },
        {
            "object": "model",
            "type": "model",
            "id": "claude-haiku-4-5",
            "display_name": "claude-haiku-4-5",
        },
        {
            "object": "model",
            "type": "model",
            "id": "claude-sonnet-4",
            "display_name": "claude-sonnet-4",
        },
        {
            "object": "model",
            "type": "model",
            "id": "claude-3-5-sonnet",
            "display_name": "claude-3-5-sonnet",
        },
        {
            "object": "model",
            "type": "model",
            "id": "claude-3-haiku",
            "display_name": "claude-3-haiku",
        },
        {
            "object": "model",
            "type": "model",
            "id": "gemini-2.5-flash",
            "display_name": "gemini-2.5-flash",
        },
        {
            "object": "model",
            "type": "model",
            "id": "qwen3.7-flash",
            "display_name": "qwen3.7-flash (DashScope)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "glm-5.3",
            "display_name": "glm-5.3 (Z.AI)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "glm-5.3-flash",
            "display_name": "glm-5.3-flash (Z.AI)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "glm-4.5-air",
            "display_name": "glm-4.5-air (Z.AI)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "glm-4.7-flashx",
            "display_name": "glm-4.7-flashx (Z.AI)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "z-image-turbo",
            "display_name": "z-image-turbo (DashScope)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "gpt-image-1",
            "display_name": "gpt-image-1 (mock)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "dall-e-3",
            "display_name": "dall-e-3 (mock)",
        },
        {
            "object": "model",
            "type": "model",
            "id": "gemini-2.0-flash-preview-image-generation",
            "display_name": "gemini-image (mock)",
        },
    ]

    cache_key = f"models:{free_user}"
    cached = _models_cache.get(cache_key)
    if cached and (time.monotonic() - cached["ts"] < 300):
        data_cached = cached["data"]
        if free_user:
            data_cached = [m for m in data_cached if _is_free_tier_model(m.get("id") or "")]
        return JSONResponse(content={"object": "list", "data": data_cached})
    upstream = None
    if settings.deepseek_api_key:
        try:
            async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                resp = await client.get(f"{settings.deepseek_url}/models", headers=_deepseek_headers())
                upstream = resp.json()
        except httpx.ConnectError:
            pass
    if upstream is None:
        try:
            async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)) as client:
                resp = await client.get(f"{settings.sglang_url}/v1/models")
                upstream = resp.json()
        except httpx.ConnectError:
            upstream = {"object": "list", "data": []}

    upstream_ids = {m.get("id") for m in upstream.get("data") or [] if isinstance(m, dict)}
    data = list(gateway_models)
    for m in upstream.get("data") or []:
        if isinstance(m, dict) and m.get("id") not in upstream_ids and m.get("id") not in {
            g["id"] for g in gateway_models
        }:
            data.append(m)
    _models_cache["all"] = {"data": data, "ts": time.monotonic()}
    _models_cache[cache_key] = {"data": data, "ts": time.monotonic()}
    if free_user:
        data = [m for m in data if _is_free_tier_model(m.get("id") or "")]
    return JSONResponse(content={"object": "list", "data": data})

