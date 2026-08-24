import re
import os
import json
from pathlib import Path
from urllib.parse import parse_qs, quote
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.config import settings, BASE_DIR
from backend.db.database import get_db
from backend.db.models import User
from backend.auth.session import create_session_token, require_session

router = APIRouter(prefix="/auth/youtube", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
YOUTUBE_MEMBERS_SCOPE = "https://www.googleapis.com/auth/youtube.channel-memberships.creator"
YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
YOUTUBE_MEMBERS_API = "https://www.googleapis.com/youtube/v3/members"
YOUTUBE_CHANNELS_API = "https://www.googleapis.com/youtube/v3/channels"


def _data_dir() -> Path:
    """Directory for persistent runtime data (members.json, owner token, ...)."""
    if settings.data_dir:
        return Path(settings.data_dir)
    return BASE_DIR / "data"


def _members_json_path() -> str:
    """Resolve the fallback member-list JSON file path (persisted in data_dir)."""
    if settings.members_json_path:
        return settings.members_json_path
    return str(_data_dir() / "members.json")


def _extract_member_ids_from_payload(payload) -> set[str]:
    """Extract member channel IDs from a pasted members API JSON response.

    Accepts several shapes:
      - Raw members.list response: {"items": [{"snippet": {"memberDetails": {"channelId": "UC..."}}}], ...}
      - A bare list of channel IDs: ["UC...", "UC..."]
      - An object with a channel_ids key: {"channel_ids": ["UC..."]}
    """
    ids: set[str] = set()
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, str) and item.startswith("UC"):
                ids.add(item)
            elif isinstance(item, dict):
                ids |= _extract_member_ids_from_payload(item)
    elif isinstance(payload, dict):
        for item in payload.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            channel_id = item.get("snippet", {}).get("memberDetails", {}).get("channelId")
            if channel_id:
                ids.add(channel_id)
        for key in ("channel_ids", "channelIds", "members"):
            value = payload.get(key)
            if value:
                ids |= _extract_member_ids_from_payload(value)
    return {i for i in ids if isinstance(i, str) and i.startswith("UC")}


def _load_stored_member_ids() -> set[str]:
    """Read member channel IDs from the fallback JSON file."""
    path = _members_json_path()
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return set()
    return _extract_member_ids_from_payload(payload)


def _load_stored_member_tiers() -> dict[str, str]:
    """Read channel ID -> tier_id map from the fallback JSON file.

    Tolerates both the raw members.list shape (tiers derived from
    highestAccessibleLevelDisplayName) and the normalized {"channel_ids":[...],
    "tiers": {...}} shape.
    """
    path = _members_json_path()
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

    tiers: dict[str, str] = {}
    if isinstance(payload, dict):
        stored = payload.get("tiers")
        if isinstance(stored, dict):
            for channel_id, tier in stored.items():
                if isinstance(channel_id, str) and isinstance(tier, str):
                    tiers[channel_id] = _tier_id_from_display_name(tier)
        for item in payload.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            snippet = item.get("snippet", {})
            channel_id = snippet.get("memberDetails", {}).get("channelId")
            if not channel_id:
                continue
            display_name = snippet.get("membershipsDetails", {}).get(
                "highestAccessibleLevelDisplayName", ""
            )
            tiers[channel_id] = _tier_id_from_display_name(display_name)
    return tiers


def _save_stored_member_ids(
    member_ids: set[str],
    tiers: dict[str, str] | None = None,
    levels: dict[str, str] | None = None,
) -> None:
    """Persist member channel IDs (+ optional tier map + level map) to the fallback JSON file."""
    path = _members_json_path()
    payload: dict = {"channel_ids": sorted(member_ids), "updated_at": None}
    if tiers:
        payload["tiers"] = {
            cid: _tier_id_from_display_name(tier) for cid, tier in tiers.items()
        }
    if levels:
        payload["levels"] = {
            level_id: _tier_id_from_display_name(tier)
            for level_id, tier in levels.items()
        }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def _load_stored_level_tiers() -> dict[str, str]:
    """Read level ID -> tier_id map from the fallback JSON file."""
    path = _members_json_path()
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    levels: dict[str, str] = {}
    if isinstance(payload, dict):
        stored = payload.get("levels")
        if isinstance(stored, dict):
            for level_id, tier in stored.items():
                if isinstance(level_id, str) and isinstance(tier, str):
                    levels[level_id] = _tier_id_from_display_name(tier)
        levels.update(_extract_level_tiers_from_payload(payload))
    return levels


def _owner_token_path() -> Path:
    """Path to the persisted owner refresh token (data_dir, survives restarts)."""
    return _data_dir() / "owner_refresh_token"


def _persist_env(key: str, value: str) -> None:
    """Persist a runtime value to a file in data_dir (NOT backend/.env).

    Previously this wrote directly into backend/.env, which is ephemeral in a
    container and lost on restart. Now values live on the persistent /data
    volume so OAuth tokens survive container restarts.
    """
    path = _data_dir() / (key.lower() if not key.islower() else key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(value, encoding="utf-8")
    os.replace(tmp_path, path)


def _load_persisted_env(key: str) -> str:
    """Read a previously persisted runtime value from data_dir."""
    path = _data_dir() / key
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def _get_owner_flow_url() -> str:
    return (
        f"{GOOGLE_AUTH_URL}"
        f"?client_id={settings.google_client_id}"
        f"&redirect_uri={settings.redirect_uri}"
        f"&response_type=code"
        f"&scope=openid%20email%20profile%20{YOUTUBE_MEMBERS_SCOPE}%20{YOUTUBE_READONLY_SCOPE}"
        f"&access_type=offline"
        f"&prompt=consent"
    )


def _get_user_flow_url(state: str = "") -> str:
    url = (
        f"{GOOGLE_AUTH_URL}"
        f"?client_id={settings.google_client_id}"
        f"&redirect_uri={settings.redirect_uri}"
        f"&response_type=code"
        f"&scope=openid%20email%20profile%20{YOUTUBE_READONLY_SCOPE}"
        f"&access_type=online"
    )
    if state:
        url += f"&state={state}"
    return url


async def _exchange_code(client: httpx.AsyncClient, code: str) -> dict:
    resp = await client.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange auth code")
    return resp.json()


async def _get_google_user(client: httpx.AsyncClient, access_token: str) -> dict:
    resp = await client.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to get user info")
    return resp.json()


async def _fetch_member_channel_ids(client: httpx.AsyncClient, access_token: str) -> set[str]:
    """Fetch the Channel IDs of all current members of the owner's YouTube channel.

    NOTE: YouTube's members.list never returns emails; it returns the member's
    channel ID under snippet.memberDetails.channelId. Matching on channel ID is
    the only reliable way to verify membership.
    """
    member_ids = set()
    page_token = None
    while True:
        params = {"part": "snippet", "mode": "all_current", "maxResults": 200}
        if page_token:
            params["pageToken"] = page_token
        resp = await client.get(
            YOUTUBE_MEMBERS_API,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        if resp.status_code != 200:
            break
        data = resp.json()
        for item in data.get("items", []):
            if not isinstance(item, dict):
                continue
            details = item.get("snippet", {}).get("memberDetails", {})
            channel_id = details.get("channelId")
            if channel_id:
                member_ids.add(channel_id)
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return member_ids


# Map YouTube membership level display names to gateway tier ids.
_TIER_BY_DISPLAY_NAME = {
    "nomad": "nomad",
    "dreamer": "dreamer",
    "entrepreneur": "entrepreneur",
    "angel": "angel",
    "angel investor": "angel",
}
_DEFAULT_MEMBER_TIER = "nomad"


def _tier_id_from_display_name(display_name: str) -> str:
    if not display_name:
        return _DEFAULT_MEMBER_TIER
    return _TIER_BY_DISPLAY_NAME.get(display_name.strip().lower(), _DEFAULT_MEMBER_TIER)


def _extract_level_tiers_from_payload(payload) -> dict[str, str]:
    """Map YouTube level IDs to tier ids from a membershipsLevelList response.

    Accepts the raw membershipsLevelList response shape:
      {"items": [{"id": "CKDtrd6pg9bzVA", "snippet": {"levelDetails": {"displayName": "Nomad"}}}]}
    """
    levels: dict[str, str] = {}
    if isinstance(payload, dict):
        for item in payload.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            level_id = item.get("id")
            display_name = (
                item.get("snippet", {}).get("levelDetails", {}).get("displayName", "")
            )
            if level_id and display_name:
                levels[level_id] = _tier_id_from_display_name(display_name)
    return levels


def _tier_id_from_level_id(level_id: str, levels: dict[str, str] | None) -> str:
    """Resolve a YouTube level ID to a tier id using the stored levels map."""
    if not level_id:
        return _DEFAULT_MEMBER_TIER
    if levels and level_id in levels:
        return levels[level_id]
    return _DEFAULT_MEMBER_TIER


async def _fetch_member_tiers(client: httpx.AsyncClient, access_token: str) -> dict[str, str]:
    """Fetch channel ID -> tier_id for all current members.

    Reads the membership level display name (Nomad/Dreamer/...) from
    snippet.membershipsDetails.highestAccessibleLevelDisplayName. When the
    display name is absent, falls back to mapping the level ID
    (highestAccessibleLevel) through the stored levels map.
    """
    levels = _load_stored_level_tiers()
    tiers: dict[str, str] = {}
    page_token = None
    while True:
        params = {"part": "snippet", "mode": "all_current", "maxResults": 200}
        if page_token:
            params["pageToken"] = page_token
        resp = await client.get(
            YOUTUBE_MEMBERS_API,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        if resp.status_code != 200:
            break
        data = resp.json()
        for item in data.get("items", []):
            if not isinstance(item, dict):
                continue
            snippet = item.get("snippet", {})
            details = snippet.get("memberDetails", {})
            channel_id = details.get("channelId")
            if not channel_id:
                continue
            memberships = snippet.get("membershipsDetails", {})
            display_name = memberships.get("highestAccessibleLevelDisplayName", "")
            if display_name:
                tiers[channel_id] = _tier_id_from_display_name(display_name)
            else:
                level_id = memberships.get("highestAccessibleLevel", "")
                tiers[channel_id] = _tier_id_from_level_id(level_id, levels)
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return tiers


async def _get_user_channel_id(client: httpx.AsyncClient, access_token: str) -> str | None:
    """Fetch the authenticated user's own YouTube Channel ID (mine=true)."""
    resp = await client.get(
        YOUTUBE_CHANNELS_API,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"part": "id", "mine": "true"},
    )
    if resp.status_code != 200:
        return None
    items = resp.json().get("items", [])
    return items[0].get("id") if items else None


def _owner_refresh_token() -> str:
    """Owner refresh token from env (preferred) or the persisted data_dir file."""
    if settings.owner_refresh_token:
        return settings.owner_refresh_token
    return _load_persisted_env("OWNER_REFRESH_TOKEN")


async def _get_owner_access_token(client: httpx.AsyncClient) -> str | None:
    refresh_token = _owner_refresh_token()
    if not refresh_token:
        return None
    resp = await client.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    if resp.status_code != 200:
        return None
    return resp.json().get("access_token")


async def _is_youtube_member(client: httpx.AsyncClient, user_channel_id: str | None) -> bool:
    """Check if a user's channel is currently a YouTube member of the owner's channel.

    Tries the live members API first (owner refresh token + members scope). If
    that is unavailable (no refresh token, or the API errors — e.g. missing
    permission in Google Cloud Console), falls back to the stored member list.
    """
    if not user_channel_id:
        return False
    member_ids: set[str] = set()
    owner_access_token = await _get_owner_access_token(client)
    if owner_access_token:
        try:
            member_ids = await _fetch_member_channel_ids(client, owner_access_token)
        except Exception:
            member_ids = set()
    if not member_ids:
        member_ids = _load_stored_member_ids()
    return user_channel_id in member_ids


def _is_owner(email: str) -> bool:
    """A user is the owner only when a non-empty email matches the configured owner email."""
    owner_email = (settings.owner_google_email or "").strip().lower()
    return bool(email and owner_email and email.strip().lower() == owner_email)


@router.get("/login")
async def youtube_login():
    return RedirectResponse(url=_get_owner_flow_url())


@router.get("/login/user")
async def user_login(request: Request):
    redirect = request.query_params.get("redirect", "")
    state = f"redirect={redirect}" if redirect else ""
    return RedirectResponse(url=_get_user_flow_url(state))


@router.get("/callback")
async def youtube_callback(
    db: AsyncSession = Depends(get_db),
    code: str | None = None,
    error: str | None = None,
    state: str = "",
):
    # Safely parse state query string
    parsed_state = parse_qs(state)
    target_redirect = parsed_state.get("redirect", [""])[0]

    # Google redirects here with `error` when the user denies consent.
    if error:
        if target_redirect == "dashboard":
            return RedirectResponse(
                url=f"{settings.dashboard_url}/callback?error={quote(error, safe='')}"
            )
        raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    async with httpx.AsyncClient() as client:
        tokens = await _exchange_code(client, code)
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Token exchange did not return an access token")
        user_info = await _get_google_user(client, access_token)
        user_channel_id = await _get_user_channel_id(client, access_token)
        member = await _is_youtube_member(client, user_channel_id)

    email = user_info.get("email", "").lower()
    google_sub = user_info.get("id", "")

    stmt = select(User).where(User.google_sub == google_sub)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    avatar_url = user_info.get("picture", "")
    is_owner = _is_owner(email)

    if not user:
        user = User(
            google_email=email,
            google_sub=google_sub,
            youtube_channel_id=user_channel_id,
            display_name=user_info.get("name", ""),
            avatar_url=avatar_url,
            is_owner=is_owner,
            is_member=is_owner or member,
        )
        db.add(user)
        try:
            await db.commit()
        except IntegrityError:
            # Lost a race with a concurrent login for the same google_sub.
            await db.rollback()
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()
            if user is None:
                raise HTTPException(status_code=500, detail="Failed to create user")
    else:
        user.display_name = user_info.get("name", "") or user.display_name
        if avatar_url:
            user.avatar_url = avatar_url
        if user_channel_id:
            user.youtube_channel_id = user_channel_id
        user.is_owner = is_owner
        user.is_member = is_owner or member
        await db.commit()

    if refresh_token and user.is_owner:
        settings.owner_refresh_token = refresh_token
        _persist_env("OWNER_REFRESH_TOKEN", refresh_token)
    session_token = create_session_token(user.id)

    if target_redirect == "dashboard":
        # Token in the URL fragment (not query) so it is never sent to a server
        # via Referer and does not appear in server logs / browser history.
        return RedirectResponse(url=f"{settings.dashboard_url}/callback#token={session_token}")

    return JSONResponse({
        "status": "authenticated",
        "user": {"email": email, "is_owner": user.is_owner, "is_member": user.is_member},
        "session_token": session_token,
    })


@router.post("/verify-members")
async def verify_members(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_session),
):
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    owner = result.scalar_one_or_none()
    if not owner or not owner.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")

    member_ids: set[str] = set()
    if settings.owner_refresh_token:
        async with httpx.AsyncClient() as client:
            access_token = await _get_owner_access_token(client)
            if access_token:
                try:
                    member_ids = await _fetch_member_channel_ids(client, access_token)
                except Exception:
                    member_ids = set()
    if not member_ids:
        member_ids = _load_stored_member_ids()

    stmt = select(User)
    result = await db.execute(stmt)
    all_users = result.scalars().all()

    updated = 0
    for u in all_users:
        was_member = u.is_member
        # Always maintain owner membership rights regardless of API response
        u.is_member = u.is_owner or (u.youtube_channel_id in member_ids)
        if was_member != u.is_member:
            updated += 1

    await db.commit()
    return JSONResponse({"total_members": len(member_ids), "users_updated": updated})


@router.get("/members")
async def get_stored_members(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: read the current fallback member list."""
    result = await db.execute(select(User).where(User.id == user_id))
    owner = result.scalar_one_or_none()
    if not owner or not owner.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")

    member_ids = _load_stored_member_ids()
    return JSONResponse({"total_members": len(member_ids), "channel_ids": sorted(member_ids)})


@router.post("/members")
async def set_stored_members(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: replace the fallback member list.

    Body is the raw members.list JSON response (or a plain list of channel IDs).
    Used when the YouTube members API is unavailable via OAuth.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    owner = result.scalar_one_or_none()
    if not owner or not owner.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")

    payload = await request.json()
    member_ids = _extract_member_ids_from_payload(payload)
    if not member_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                "No member channel IDs found. Paste the raw members.list JSON "
                "response (items[].snippet.memberDetails.channelId) or a list of "
                "channel IDs like ['UC...', 'UC...']."
            ),
        )

    # Preserve tier info when available (raw members.list response or a tiers map).
    tiers: dict[str, str] = {}
    if isinstance(payload, dict):
        stored = payload.get("tiers")
        if isinstance(stored, dict):
            tiers = {
                str(k): _tier_id_from_display_name(str(v))
                for k, v in stored.items()
            }
        for item in payload.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            snippet = item.get("snippet", {})
            channel_id = snippet.get("memberDetails", {}).get("channelId")
            if not channel_id:
                continue
            display_name = snippet.get("membershipsDetails", {}).get(
                "highestAccessibleLevelDisplayName", ""
            )
            if display_name:
                tiers[channel_id] = _tier_id_from_display_name(display_name)

    _save_stored_member_ids(member_ids, tiers or None)
    return JSONResponse({"total_members": len(member_ids), "channel_ids": sorted(member_ids)})


@router.post("/levels")
async def set_stored_levels(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: save the YouTube memberships level ID -> tier map.

    Body is the raw membershipsLevelList JSON response (or {"levels": {...}}).
    Used to resolve member tiers when members.list returns only level IDs
    without display names.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    owner = result.scalar_one_or_none()
    if not owner or not owner.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")

    payload = await request.json()
    levels = _extract_level_tiers_from_payload(payload)
    if isinstance(payload, dict) and isinstance(payload.get("levels"), dict):
        for level_id, tier in payload["levels"].items():
            levels[str(level_id)] = _tier_id_from_display_name(str(tier))
    if not levels:
        raise HTTPException(
            status_code=400,
            detail="No levels found. Paste the membershipsLevelList JSON response or a levels map.",
        )

    # Persist levels alongside the current member list.
    member_ids = _load_stored_member_ids()
    tiers = _load_stored_member_tiers()
    _save_stored_member_ids(member_ids, tiers, levels)
    return JSONResponse({"levels": levels})


@router.delete("/members")
async def clear_stored_members(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: clear the fallback member list (revert to live API only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    owner = result.scalar_one_or_none()
    if not owner or not owner.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")

    path = _members_json_path()
    if os.path.exists(path):
        os.remove(path)
    return JSONResponse({"total_members": 0, "channel_ids": []})


@router.get("/status")
async def youtube_members_status(
    user_id: str = Depends(require_session),
):
    """Check whether the YouTube members API is live and functional.

    Any logged-in user may call this. The frontend uses it to decide whether
    "Join YouTube member" will be picked up automatically; when it returns
    available=false, the UI tells the user to contact support or use Stripe.
    """
    from backend.auth.members import check_api_status

    status = await check_api_status()
    return status