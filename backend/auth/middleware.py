from fastapi import Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.auth.api_keys import get_api_key_by_prefix, verify_api_key, touch_api_key


def extract_key_prefix(raw_key: str) -> str | None:
    if not raw_key.startswith("sk-dt-"):
        return None
    parts = raw_key.split("-")
    if len(parts) < 4:
        return None
    return "-".join(parts[:3])


async def require_api_key(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    raw_key = auth_header.removeprefix("Bearer ").strip()
    prefix = extract_key_prefix(raw_key)
    if not prefix:
        raise HTTPException(status_code=401, detail="Invalid API key format")
    entry = await get_api_key_by_prefix(db, prefix)
    if not entry or not verify_api_key(raw_key, entry.key_hash):
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    await touch_api_key(db, entry.id)
    return entry.user_id
