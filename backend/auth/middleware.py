from fastapi import Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from cachetools import TTLCache

from backend.db.database import get_db
from backend.auth.api_keys import get_api_key_by_prefix, verify_api_key, touch_api_key

_api_key_cache: TTLCache = TTLCache(maxsize=2048, ttl=300)


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
    # Anthropic SDKs/clients send the key as `x-api-key`; OpenAI-style clients send `Authorization: Bearer`.
    auth_header = request.headers.get("Authorization", "")
    raw_key = ""
    if auth_header.startswith("Bearer "):
        raw_key = auth_header.removeprefix("Bearer ").strip()
    else:
        raw_key = (request.headers.get("x-api-key") or "").strip()
    if not raw_key:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    prefix = extract_key_prefix(raw_key)
    if not prefix:
        raise HTTPException(status_code=401, detail="Invalid API key format")
    cached = _api_key_cache.get(prefix)
    if cached and verify_api_key(raw_key, cached["hash"]):
        entry = cached["entry"]
    else:
        entry = await get_api_key_by_prefix(db, prefix)
        if not entry or not verify_api_key(raw_key, entry.key_hash):
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        _api_key_cache[prefix] = {"hash": entry.key_hash, "entry": entry}
    await touch_api_key(db, entry.id)
    return entry.user_id
