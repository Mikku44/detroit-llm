"""At-rest encryption for API key raw values.

Raw API keys are stored encrypted (AES-256-GCM) so a database leak does not
expose working keys. They remain decryptable with the gateway's secret, so the
dashboard can still show the full key when listing keys.

The key is derived from `ENCRYPTION_KEY` (or JWT_SECRET as a fallback), so it
is stable across restarts.
"""

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.config import settings

_NAMESPACE = b"detroit-llm-api-key-v1"


def _encryption_key() -> bytes:
    material = (settings.encryption_key or settings.jwt_secret).encode("utf-8")
    return hashlib.sha256(_NAMESPACE + material).digest()


def encrypt_api_key(raw_key: str) -> str:
    """Encrypt a raw key to base64(nonce + ciphertext + tag)."""
    if not raw_key:
        return ""
    nonce = os.urandom(12)
    ciphertext = AESGCM(_encryption_key()).encrypt(nonce, raw_key.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_api_key(blob: str) -> str:
    """Decrypt base64(nonce + ciphertext + tag) back to the raw key."""
    if not blob:
        return ""
    try:
        raw = base64.b64decode(blob)
    except Exception:
        return ""
    if len(raw) < 13:
        return ""
    nonce, ciphertext = raw[:12], raw[12:]
    try:
        return AESGCM(_encryption_key()).decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception:
        return ""
