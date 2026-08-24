"""Automatic YouTube member-list sync.

Keeps user membership flags fresh without anyone needing to re-login:

1. Tries the live YouTube members API first (owner refresh token).
2. Falls back to the stored JSON file (members.json) when the API is
   unavailable (e.g. no Google Cloud Console permission).
3. A background task (started in main.py lifespan) periodically re-syncs
   `User.is_member` for all users.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from backend.auth.youtube import (
    _fetch_member_channel_ids,
    _fetch_member_tiers,
    _get_owner_access_token,
    _load_stored_member_ids,
    _load_stored_member_tiers,
    _save_stored_member_ids,
)
from backend.config import settings
from backend.db.database import async_session
from backend.db.models import User

log = logging.getLogger("uvicorn.error")

# In-memory cache of member channel IDs + tier map (shared across sync runs).
_member_cache: set[str] = set()
_tier_cache: dict[str, str] = {}
_cache_loaded = False


def _get_member_ids_sync() -> set[str]:
    """Return the currently cached member ID set (loaded from storage if needed)."""
    global _member_cache, _tier_cache, _cache_loaded
    if not _cache_loaded:
        _member_cache = _load_stored_member_ids()
        _tier_cache = _load_stored_member_tiers()
        _cache_loaded = True
    return _member_cache


def _get_member_tiers_sync() -> dict[str, str]:
    global _cache_loaded
    if not _cache_loaded:
        _get_member_ids_sync()
    return _tier_cache


async def _refresh_member_ids_from_api() -> bool:
    """Fetch member channel IDs + tiers from the live YouTube API.

    Returns True on success (and updates the cache + persisted file), False when
    the API is unavailable so the caller falls back to the stored list.
    """
    if not settings.owner_refresh_token:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            access_token = await _get_owner_access_token(client)
            if not access_token:
                return False
            member_ids = await _fetch_member_channel_ids(client, access_token)
            tiers = await _fetch_member_tiers(client, access_token)
    except Exception as exc:
        log.warning("member sync: YouTube API failed (%s: %s)", type(exc).__name__, exc)
        return False

    if member_ids:
        _save_member_cache(member_ids, tiers)
        return True
    return False


async def check_api_status() -> dict:
    """Report whether the live YouTube members API is functional.

    Used by the dashboard to decide whether "Join YouTube member" will be picked
    up automatically, or whether the user should be told to contact support /
    use Stripe instead.
    """
    if not settings.owner_refresh_token:
        return {
            "available": False,
            "reason": "owner_not_configured",
            "detail": "No owner refresh token configured.",
        }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            access_token = await _get_owner_access_token(client)
            if not access_token:
                return {
                    "available": False,
                    "reason": "token_refresh_failed",
                    "detail": "Owner access token could not be refreshed.",
                }
            from backend.auth import youtube as yt
            resp = await client.get(
                yt.YOUTUBE_MEMBERS_API,
                headers={"Authorization": f"Bearer {access_token}"},
                params={"part": "snippet", "mode": "all_current", "maxResults": 1},
            )
            if resp.status_code != 200:
                return {
                    "available": False,
                    "reason": "api_error",
                    "detail": (
                        f"YouTube members API returned {resp.status_code}. "
                        "Membership verification is unavailable."
                    ),
                }
            data = resp.json()
            member_ids = {
                item.get("snippet", {}).get("memberDetails", {}).get("channelId")
                for item in (data.get("items") or [])
                if item.get("snippet", {}).get("memberDetails", {}).get("channelId")
            }
            tiers = await _fetch_member_tiers(client, access_token)
    except Exception as exc:
        log.warning("member sync: API check failed (%s: %s)", type(exc).__name__, exc)
        return {
            "available": False,
            "reason": "api_error",
            "detail": f"{type(exc).__name__}: {exc}",
        }
    if member_ids:
        _save_member_cache(member_ids, tiers)
    return {
        "available": True,
        "reason": "ok",
        "member_count": len(member_ids),
        "detail": "YouTube members API is working.",
    }


def _save_member_cache(member_ids: set[str], tiers: dict[str, str] | None = None) -> None:
    global _member_cache, _tier_cache, _cache_loaded
    _member_cache = set(member_ids)
    _tier_cache = dict(tiers or {})
    _cache_loaded = True
    try:
        _save_stored_member_ids(member_ids, tiers or {})
    except Exception as exc:
        log.warning("member sync: failed to persist members.json (%s)", exc)


async def fetch_member_ids(force_api: bool = False) -> set[str]:
    """Return the freshest set of member channel IDs.

    Tries the live API; on failure falls back to the persisted JSON list.
    """
    if force_api or not _cache_loaded:
        if await _refresh_member_ids_from_api():
            return _member_cache
    return _get_member_ids_sync()


async def fetch_member_tiers(force_api: bool = False) -> dict[str, str]:
    """Return channel ID -> tier_id for all current members."""
    if force_api or not _cache_loaded:
        if await _refresh_member_ids_from_api():
            return _tier_cache
    return _get_member_tiers_sync()


async def is_member_channel(channel_id: str | None) -> bool:
    """True when a channel ID is a current member (live or persisted fallback)."""
    if not channel_id:
        return False
    return channel_id in await fetch_member_ids()


async def sync_all_users() -> dict:
    """Update `User.is_member` and `User.tier_id` for every user.

    Returns a summary dict for logging / admin feedback.
    """
    member_ids = await fetch_member_ids(force_api=True)
    tiers = await fetch_member_tiers()

    updated = 0
    total = 0
    async with async_session() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        total = len(users)
        for u in users:
            was_member = u.is_member
            # Owner always keeps membership; otherwise match the member list.
            u.is_member = u.is_owner or (u.youtube_channel_id in member_ids)
            # Remember the tier for YouTube members (Stripe subscribers set
            # tier_id via the webhook instead, so don't overwrite those).
            if u.youtube_channel_id and u.youtube_channel_id in tiers and not u.is_paid:
                u.tier_id = tiers[u.youtube_channel_id]
            if u.is_member != was_member:
                updated += 1
        await db.commit()

    return {"total_members": len(member_ids), "users": total, "updated": updated}


async def _sync_loop() -> None:
    """Background task: re-sync membership every N seconds."""
    interval = max(30, settings.members_sync_interval_seconds)
    while True:
        try:
            summary = await sync_all_users()
            log.info("member sync: %s", summary)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("member sync failed: %s", exc)
        await asyncio.sleep(interval)


async def start_sync_task() -> asyncio.Task:
    """Start the background member-sync loop (cancelled on shutdown)."""
    task = asyncio.create_task(_sync_loop())
    return task
