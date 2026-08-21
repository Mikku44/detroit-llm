"""At-rest encryption for paid users' conversation messages.

Message content is encrypted with AES-256-GCM using a key derived from
(user_id, conversation_id, conversation_date), so plaintext is never stored
in the conversations DB and a row is only readable back for the owning user
on the day the conversation was created.
"""

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NAMESPACE = b"detroit-llm-conversation-v1"


def derive_key(user_id: str, chat_id: str, chat_date: str) -> bytes:
    """Deterministic 32-byte key from user + chat + chat date (YYYY-MM-DD)."""
    material = f"{user_id}:{chat_id}:{chat_date}".encode("utf-8")
    return hashlib.sha256(_NAMESPACE + material).digest()


def chat_date_of(created_at) -> str:
    """Return the conversation's creation date as YYYY-MM-DD for the key."""
    if created_at is None:
        return ""
    return created_at.strftime("%Y-%m-%d")


def encrypt_text(key: bytes, plaintext: str) -> str:
    """Encrypt a string to base64(nonce + ciphertext + tag)."""
    if not plaintext:
        return ""
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_text(key: bytes, blob: str) -> str:
    """Decrypt base64(nonce + ciphertext + tag) back to a string."""
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
        return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception:
        return ""
