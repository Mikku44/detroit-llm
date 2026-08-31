from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date

import time as _time
from cachetools import TTLCache

from backend.config import settings, TIER_OPTIONS
from backend.db.database import get_db, _is_postgres
from backend.db.models import User, ApiKey, UsageLog, ImageUsage, Payment
from backend.auth.session import require_session
from backend.auth.api_keys import create_api_key_for_user, revoke_api_key
from backend.auth.key_encryption import decrypt_api_key

router = APIRouter(prefix="/admin", tags=["admin"])

_status_cache: TTLCache = TTLCache(maxsize=32, ttl=15)


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
        "is_verified": user.is_verified,
        "is_paid": user.is_paid,
        "tier_id": user.tier_id,
        "phone_number": user.phone_number,
        "created_at": user.created_at.isoformat(),
    }


@router.post("/me/phone")
async def verify_phone(
    body: dict,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Save a phone number verified via Firebase phone auth.

    Body: {"phone_number": "+66123456789"}
    The phone number is already verified client-side by Firebase before this
    call; here we just persist it and mark the user as verified.
    """
    phone = (body.get("phone_number") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="phone_number is required")

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.phone_number = phone
    user.is_verified = True
    await db.commit()
    return {"phone_number": user.phone_number, "is_verified": user.is_verified}


@router.get("/payments")
async def list_payments(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Payment history for the logged-in user."""
    stmt = (
        select(Payment)
        .where(Payment.user_id == user_id)
        .order_by(Payment.created_at.desc())
    )
    result = await db.execute(stmt)
    payments = result.scalars().all()
    return {
        "payments": [
            {
                "id": p.id,
                "tier_id": p.tier_id,
                "amount": p.amount,
                "currency": p.currency,
                "status": p.status,
                "event_type": p.event_type,
                "checkout_session_id": p.checkout_session_id,
                "subscription_id": p.stripe_subscription_id,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in payments
        ]
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
                "key": decrypt_api_key(k.raw_key) or "",
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
    elif user.is_member or user.is_paid:
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

    # Monthly image quota (calendar month).
    month_start = now_naive.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    image_stmt = select(func.count(ImageUsage.id)).where(
        ImageUsage.user_id == user_id, ImageUsage.created_at >= month_start
    )
    images_used = int((await db.execute(image_stmt)).scalar_one() or 0)

    tier_map = {t["id"]: t for t in TIER_OPTIONS}

    # If the user carries a tier_id (from a Stripe subscription or the
    # YouTube membership level→tier mapping) reflect that tier's real
    # limits. Owner/YT-member users without a tier stay uncapped.
    tier = tier_map.get(user.tier_id or "")
    if tier and tier["id"] != "free":
        current_tier_id = tier["id"]
        weekly_limit = tier["weekly"]
        monthly_limit = tier["monthly"]
        image_quota = tier.get("image_quota", 0)
    elif user.is_owner or user.is_member:
        current_tier_id = None
        weekly_limit = None
        monthly_limit = None
        image_quota = 10000
    else:
        current_tier_id = "free"
        weekly_limit = settings.free_weekly_tokens
        monthly_limit = settings.free_monthly_tokens
        image_quota = tier_map["free"].get("image_quota", 0)

    is_free = plan == "free"
    return {
        "plan": plan,
        "is_free": is_free,
        "current_tier_id": current_tier_id,
        "weekly_limit": weekly_limit,
        "monthly_limit": monthly_limit,
        "weekly_used": weekly_used,
        "monthly_used": monthly_used,
        "image_quota": image_quota,
        "images_used": images_used,
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

    if _is_postgres(settings.database_url):
        date_expr = cast(UsageLog.created_at, Date).label("date")
    else:
        date_expr = func.date(UsageLog.created_at).label("date")

    stmt = (
        select(
            date_expr,
            func.sum(UsageLog.prompt_tokens).label("prompt_tokens"),
            func.sum(UsageLog.completion_tokens).label("completion_tokens"),
            func.count(UsageLog.id).label("requests"),
        )
        .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
        .where(ApiKey.user_id == user_id, UsageLog.created_at >= cutoff)
        .group_by(date_expr)
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

    if _is_postgres(settings.database_url):
        # Postgres: EXTRACT(DOW) returns 0=Sunday..6=Saturday (same as %w),
        # EXTRACT(HOUR) returns 0-23.
        weekday_expr = func.extract("dow", UsageLog.created_at).label("weekday")
        hour_expr = func.extract("hour", UsageLog.created_at).label("hour")
    else:
        # SQLite: strftime %w (0=Sunday) and %H (0-23).
        weekday_expr = func.strftime("%w", UsageLog.created_at).label("weekday")
        hour_expr = func.strftime("%H", UsageLog.created_at).label("hour")

    stmt = (
        select(
            weekday_expr,
            hour_expr,
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
                "is_verified": u.is_verified,
                "is_paid": u.is_paid,
                "tier_id": u.tier_id,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]
    }


@router.post("/users/{target_user_id}/verify")
async def set_user_verified(
    target_user_id: str,
    body: dict,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: set or clear a user's manual verification flag.

    Body: {"is_verified": true|false}
    """
    await _require_owner(user_id, db)
    stmt = select(User).where(User.id == target_user_id)
    result = await db.execute(stmt)
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_verified = bool(body.get("is_verified"))
    await db.commit()
    return {"id": target.id, "is_verified": target.is_verified}


@router.get("/balances")
async def get_provider_balances(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: live balance/credits for every configured upstream provider."""
    await _require_owner(user_id, db)
    from backend.admin.balances import check_provider_balances

    providers = await check_provider_balances()
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "providers": providers,
    }


@router.get("/status")
async def get_status(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only status: upstream health, usage balance, users, and API keys."""
    await _require_owner(user_id, db)
    ck = _status_cache.get("status")
    if ck is not None:
        return ck
    import httpx

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    today_start = now_naive.replace(hour=0, minute=0, second=0, microsecond=0)

    async def totals_since(cutoff) -> tuple[int, int]:
        stmt = select(
            func.coalesce(func.sum(UsageLog.total_tokens), 0),
            func.count(UsageLog.id),
        ).where(UsageLog.created_at >= cutoff)
        r = await db.execute(stmt)
        row = r.one()
        return int(row[0] or 0), int(row[1] or 0)

    today_total, today_requests = await totals_since(today_start)
    week_total, week_requests = await totals_since(now_naive - timedelta(days=7))
    month_total, month_requests = await totals_since(now_naive - timedelta(days=30))

    total_users = int((await db.execute(select(func.count(User.id)))).scalar_one() or 0)
    owners = int(
        (await db.execute(select(func.count(User.id)).where(User.is_owner == True))).scalar_one() or 0
    )
    paid = int(
        (
            await db.execute(
                select(func.count(User.id)).where(
                    (User.is_member == True) | (User.is_owner == True) | (User.is_paid == True)
                )
            )
        ).scalar_one()
        or 0
    )
    free_users = total_users - paid

    total_keys = int((await db.execute(select(func.count(ApiKey.id)))).scalar_one() or 0)
    active_keys = int(
        (await db.execute(select(func.count(ApiKey.id)).where(ApiKey.is_active == True))).scalar_one() or 0
    )

    free_user_ids = select(User.id).where(
        (User.is_member == False) & (User.is_owner == False) & (User.is_paid == False)
    )

    async def sum_free_since(cutoff) -> int:
        stmt = (
            select(func.coalesce(func.sum(UsageLog.total_tokens), 0))
            .join(ApiKey, UsageLog.api_key_id == ApiKey.id)
            .where(ApiKey.user_id.in_(free_user_ids), UsageLog.created_at >= cutoff)
        )
        r = await db.execute(stmt)
        return int(r.scalar_one() or 0)

    free_week_used = await sum_free_since(now_naive - timedelta(days=7))
    free_month_used = await sum_free_since(now_naive - timedelta(days=30))

    sglang_ok = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{settings.sglang_url}/health")
            sglang_ok = r.status_code == 200
    except Exception:
        pass

    result = {
        "status": "ok",
        "version": "0.1.0",
        "time": now_naive.isoformat(),
        "health": {
            "sglang": sglang_ok,
            "members_url": settings.members_url,
            "providers": {
                "deepseek_configured": bool(settings.deepseek_api_key),
                "gemini_configured": bool(settings.gemini_api_key),
                "zai_configured": bool(settings.z_api_key),
                "openrouter_configured": bool(settings.openrouter_api_key),
                "image_provider": settings.image_provider,
            },
        },
        "balance": {
            "today": {"tokens": today_total, "requests": today_requests},
            "week": {"tokens": week_total, "requests": week_requests},
            "month": {"tokens": month_total, "requests": month_requests},
            "free_tier": {
                "per_user_weekly_limit": settings.free_weekly_tokens,
                "per_user_monthly_limit": settings.free_monthly_tokens,
                "weekly_used": free_week_used,
                "monthly_used": free_month_used,
                "free_users": free_users,
            },
        },
        "users": {
            "total": total_users,
            "owners": owners,
            "members": paid - owners,
            "free": free_users,
        },
        "api_keys": {"total": total_keys, "active": active_keys},
    }
    _status_cache["status"] = result
    return result
