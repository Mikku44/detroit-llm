import json
import re
from urllib.parse import parse_qs
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.config import settings, BASE_DIR
from backend.db.database import get_db
from backend.db.models import User
from backend.auth.session import create_session_token

router = APIRouter(prefix="/auth/youtube", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
YOUTUBE_MEMBERS_SCOPE = "https://www.googleapis.com/auth/youtube.channel-memberships.creator"
YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
YOUTUBE_MEMBERS_API = "https://www.googleapis.com/youtube/v3/members"
YOUTUBE_CHANNELS_API = "https://www.googleapis.com/youtube/v3/channels"


def _persist_env(key: str, value: str):
    """Write/update a key in backend/.env so tokens survive restarts."""
    env_path = BASE_DIR / ".env"
    try:
        text = env_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    if re.search(rf"^{key}=", text, flags=re.MULTILINE):
        text = re.sub(rf"^{key}=.*$", f"{key}={value}", text, flags=re.MULTILINE)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
    env_path.write_text(text, encoding="utf-8")


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
            details = item.get("snippet", {}).get("memberDetails", {})
            channel_id = details.get("channelId")
            if channel_id:
                member_ids.add(channel_id)
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return member_ids


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


async def _get_owner_access_token(client: httpx.AsyncClient) -> str | None:
    if not settings.owner_refresh_token:
        return None
    resp = await client.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": settings.owner_refresh_token,
            "grant_type": "refresh_token",
        },
    )
    if resp.status_code != 200:
        return None
    return resp.json().get("access_token")


async def _is_youtube_member(client: httpx.AsyncClient, user_channel_id: str | None) -> bool:
    """Check if a user's channel is currently a YouTube member of the owner's channel."""
    if not user_channel_id:
        return False
    owner_access_token = await _get_owner_access_token(client)
    if not owner_access_token:
        return False
    member_ids = await _fetch_member_channel_ids(client, owner_access_token)
    return user_channel_id in member_ids


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
    code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    state: str = "",
):
    async with httpx.AsyncClient() as client:
        tokens = await _exchange_code(client, code)
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        user_info = await _get_google_user(client, access_token)
        user_channel_id = await _get_user_channel_id(client, access_token)
        member = await _is_youtube_member(client, user_channel_id)

    email = user_info.get("email", "").lower()
    google_sub = user_info.get("id", "")

    stmt = select(User).where(User.google_sub == google_sub)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    avatar_url = user_info.get("picture", "")

    if not user:
        is_owner = email == settings.owner_google_email.lower()
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
        await db.commit()
        await db.refresh(user)
    else:
        is_owner = email == settings.owner_google_email.lower()
        user.display_name = user_info.get("name", "") or user.display_name
        if avatar_url:
            user.avatar_url = avatar_url
        if user_channel_id:
            user.youtube_channel_id = user_channel_id
        user.is_owner = is_owner
        if not user.is_owner:
            user.is_member = member
        else:
            user.is_member = True
        await db.commit()

    if refresh_token and user.is_owner:
        settings.owner_refresh_token = refresh_token
        _persist_env("OWNER_REFRESH_TOKEN", refresh_token)

    session_token = create_session_token(user.id)

    # Safely parse state query string
    parsed_state = parse_qs(state)
    target_redirect = parsed_state.get("redirect", [""])[0]

    if target_redirect == "dashboard":
        return RedirectResponse(url=f"{settings.dashboard_url}/callback?token={session_token}")

    return JSONResponse({
        "status": "authenticated",
        "user": {"email": email, "is_owner": user.is_owner, "is_member": user.is_member},
        "session_token": session_token,
    })


@router.post("/verify-members")
async def verify_members(
    db: AsyncSession = Depends(get_db),
):
    if not settings.owner_refresh_token:
        raise HTTPException(
            status_code=400, 
            detail="Owner not authenticated. Visit /auth/youtube/login first."
        )

    async with httpx.AsyncClient() as client:
        access_token = await _get_owner_access_token(client)
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to refresh owner token")
        member_ids = await _fetch_member_channel_ids(client, access_token)

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