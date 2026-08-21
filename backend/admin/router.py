from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.db.database import get_db
from backend.db.models import User, ApiKey, UsageLog
from backend.auth.session import require_session
from backend.auth.api_keys import create_api_key_for_user, revoke_api_key
from backend.config import settings, TIER_OPTIONS

router = APIRouter(prefix="/admin", tags=["admin"])


async def _require_owner(user_id: str, db: AsyncSession) -> User:
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user or not user.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


@router.get("/me")
async def get_me(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id,
        "email": user.google_email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "youtube_channel_id": user.youtube_channel_id,
        "is_owner": user.is_owner,
        "is_member": user.is_member,
        "created_at": user.created_at.isoformat(),
    }


@router.get("/keys")
async def list_keys(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ApiKey).where(ApiKey.user_id == user_id).order_by(ApiKey.created_at.desc())
    result = await db.execute(stmt)
    keys = result.scalars().all()
    return {
        "keys": [
            {
                "id": k.id,
                "key_prefix": k.key_prefix,
                "key": k.raw_key or "",
                "name": k.name,
                "is_active": k.is_active,
                "expires_at": k.expires_at.isoformat() if k.expires_at else None,
                "created_at": k.created_at.isoformat() if k.created_at else None,
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            }
            for k in keys
        ]
    }


@router.post("/keys")
async def create_key(
    body: dict,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    name = body.get("name", "default")
    expires_str = body.get("expires_at")
    expires_at = None
    if expires_str:
        if isinstance(expires_str, str):
            expires_str = expires_str.replace("Z", "+00:00")
            expires_at = datetime.fromisoformat(expires_str)
        else:
            expires_at = expires_str
    raw_key, entry = await create_api_key_for_user(db, user_id, name, expires_at)
    return {
        "id": entry.id,
        "key": raw_key,
        "key_prefix": entry.key_prefix,
        "name": entry.name,
        "expires_at": entry.expires_at.isoformat() if entry.expires_at else None,
        "created_at": entry.created_at.isoformat(),
    }


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: str,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    success = await revoke_api_key(db, key_id)
    if not success:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"status": "revoked"}


@router.get("/usage/limits")
async def get_usage_limits(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Tier limits + current usage + tier pricing table, for the usage page."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_owner:
        plan = "owner"
    elif user.is_member:
        plan = "member"
    else:
        plan = "free"

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)

    async def sum_tokens_since(cutoff) -> int:
        usage_stmt = (
            select(func.coalesce(func.sum(UsageLog.total_tokens), 0))
            .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
            .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        )
        r = await db.execute(usage_stmt)
        return int(r.scalar_one())

    weekly_used = await sum_tokens_since(now_naive - timedelta(days=7))
    monthly_used = await sum_tokens_since(now_naive - timedelta(days=30))

    is_free = plan == "free"
    return {
        "plan": plan,
        "is_free": is_free,
        "current_tier_id": "free" if is_free else None,
        "weekly_limit": settings.free_weekly_tokens if is_free else None,
        "monthly_limit": settings.free_monthly_tokens if is_free else None,
        "weekly_used": weekly_used,
        "monthly_used": monthly_used,
        "tiers": TIER_OPTIONS,
    }


@router.get("/usage")
async def get_usage(
    days: int = 7,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    start_date = (now_naive - timedelta(days=days - 1)).date()
    cutoff = datetime.combine(start_date, datetime.min.time())

    stmt = (
        select(
            func.date(UsageLog.created_at).label("date"),
            func.sum(UsageLog.prompt_tokens).label("prompt_tokens"),
            func.sum(UsageLog.completion_tokens).label("completion_tokens"),
            func.count(UsageLog.id).label("requests"),
        )
        .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
        .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        .group_by(func.date(UsageLog.created_at))
    )
    result = await db.execute(stmt)
    rows = result.fetchall()
    by_date = {str(r.date): r for r in rows}

    usage = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        r = by_date.get(str(d))
        usage.append(
            {
                "date": str(d),
                "requests": r.requests if r else 0,
                "prompt_tokens": int(r.prompt_tokens) if r else 0,
                "completion_tokens": int(r.completion_tokens) if r else 0,
                "total_tokens": (int(r.prompt_tokens) + int(r.completion_tokens)) if r else 0,
            }
        )

    return {"days": days, "usage": usage}


@router.get("/usage/punchcard")
async def get_usage_punchcard(
    days: int = 7,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    start_date = (now_naive - timedelta(days=days - 1)).date()
    cutoff = datetime.combine(start_date, datetime.min.time())

    stmt = (
        select(
            func.strftime("%w", UsageLog.created_at).label("weekday"),
            func.strftime("%H", UsageLog.created_at).label("hour"),
            func.count(UsageLog.id).label("count"),
        )
        .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
        .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        .group_by("weekday", "hour")
    )
    result = await db.execute(stmt)

    matrix = [[0] * 24 for _ in range(7)]
    for row in result.fetchall():
        matrix[int(row.weekday)][int(row.hour)] = int(row.count)

    max_count = max((max(r) for r in matrix), default=0)
    return {"days": days, "matrix": matrix, "max": max_count}


@router.get("/usage/models")
async def get_usage_models(
    days: int = 7,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    start_date = (now_naive - timedelta(days=days - 1)).date()
    cutoff = datetime.combine(start_date, datetime.min.time())

    stmt = (
        select(
            UsageLog.model.label("model"),
            func.count(UsageLog.id).label("requests"),
            func.sum(UsageLog.total_tokens).label("total_tokens"),
        )
        .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
        .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        .group_by(UsageLog.model)
        .order_by(func.count(UsageLog.id).desc())
    )
    result = await db.execute(stmt)

    models = [
        {
            "model": r.model or "unknown",
            "requests": int(r.requests),
            "total_tokens": int(r.total_tokens or 0),
        }
        for r in result.fetchall()
    ]
    return {"days": days, "models": models}


@router.get("/users")
async def list_users(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    await _require_owner(user_id, db)
    stmt = select(User).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    return {
        "users": [
            {
                "id": u.id,
                "email": u.google_email,
                "display_name": u.display_name,
                "avatar_url": u.avatar_url,
                "is_member": u.is_member,
                "is_owner": u.is_owner,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]
    }
