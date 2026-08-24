"""One-time migration: encrypt plaintext api_keys.raw_key values at rest.

Existing raw_key values (plaintext, started with 'sk-dt-') are re-written as
AES-256-GCM blobs so a DB leak no longer exposes working keys. Decryption still
works via ENCRYPTION_KEY / JWT_SECRET.

Run from the repo root:
    python -m backend.db.encrypt_api_keys

Safe to re-run: values that are already encrypted (not starting with 'sk-dt-')
are skipped.
"""

import asyncio

from sqlalchemy import select, update

from backend.db.database import engine, async_session
from backend.db.models import ApiKey
from backend.auth.key_encryption import encrypt_api_key, decrypt_api_key


async def main():
    async with async_session() as session:
        result = await session.execute(select(ApiKey))
        keys = result.scalars().all()
        updated = 0
        skipped = 0
        for key in keys:
            raw = key.raw_key
            if not raw:
                continue
            if raw.startswith("sk-dt-"):
                # Plaintext from the old schema -> encrypt it.
                key.raw_key = encrypt_api_key(raw)
                updated += 1
            elif not decrypt_api_key(raw):
                # Encrypted blob we cannot decrypt -> leave as-is (warn only).
                skipped += 1
            # Already a valid encrypted blob -> skip.
        await session.commit()
    print(f"Encrypted {updated} keys (skipped {skipped} unreadable).")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
