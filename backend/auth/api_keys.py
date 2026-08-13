import uuid
import secrets
import hashlib
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import ApiKey


def hash_api_key(raw_key: str) -> str:
    """Hash raw key using SHA-256 for fast, deterministic lookups/verification."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """
    Generates a raw key, its DB lookup prefix, and its hash.
    Format: sk-dt-[16 hex prefix]-[48 hex secret]
    """
    prefix_part = secrets.token_hex(8)
    secret_part = secrets.token_hex(24)
    
    raw_key = f"sk-dt-{prefix_part}-{secret_part}"
    key_prefix = f"sk-dt-{prefix_part}"
    key_hash = hash_api_key(raw_key)
    
    return raw_key, key_prefix, key_hash


def verify_api_key(raw_key: str, stored_hash: str) -> bool:
    """Uses constant-time comparison to prevent timing attacks."""
    return secrets.compare_digest(hash_api_key(raw_key), stored_hash)


async def create_api_key_for_user(
    db: AsyncSession,
    user_id: str,
    name: str = "default",
    expires_at: datetime | None = None,
) -> tuple[str, ApiKey]:
    raw_key, key_prefix, key_hash = generate_api_key()
    
    entry = ApiKey(
        id=str(uuid.uuid4()),
        key_prefix=key_prefix,
        key_hash=key_hash,
        raw_key=raw_key,
        user_id=user_id,
        name=name,
        expires_at=expires_at,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    
    return raw_key, entry


async def get_api_key_by_prefix(db: AsyncSession, prefix: str) -> ApiKey | None:
    stmt = select(ApiKey).where(
        ApiKey.key_prefix == prefix,
        ApiKey.is_active == True,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    if entry and entry.expires_at and datetime.now(timezone.utc).replace(tzinfo=None) > entry.expires_at:
        entry.is_active = False
        await db.commit()
        return None
    return entry


async def revoke_api_key(db: AsyncSession, key_id: str) -> bool:
    stmt = select(ApiKey).where(ApiKey.id == key_id)
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    
    if not entry:
        return False
        
    await db.delete(entry)
    await db.commit()
    return True


async def touch_api_key(db: AsyncSession, key_id: str):
    """Efficiently update last_used_at timestamp without fetching/refreshing the object."""
    stmt = (
        update(ApiKey)
        .where(ApiKey.id == key_id)
        .values(last_used_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    await db.execute(stmt)
    await db.commit()