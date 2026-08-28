import base64
import hashlib
import uuid
from functools import lru_cache

from backend.config import settings

_client = None

def _enabled() -> bool:
    return bool(settings.r2_endpoint and settings.r2_bucket_name and settings.r2_access_key_id and settings.r2_secret_access_key)

def is_configured() -> bool:
    return _enabled()

def _get_client():
    global _client
    if _client is not None:
        return _client
    if not _enabled():
        return None
    import boto3
    _client = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        region_name=settings.r2_region or "auto",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
    )
    return _client

def _public_url(key: str) -> str:
    ep = settings.r2_endpoint.rstrip("/")
    return f"{ep}/{settings.r2_bucket_name}/{key}"

def _ext_for_content_type(ct: str) -> str:
    ct = (ct or "").split(";")[0].strip().lower()
    return {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif"}.get(ct, "jpg")

def _key_for(prefix: str, ext: str) -> str:
    return f"{prefix.strip('/')}/{uuid.uuid4().hex}.{ext}"

def upload_bytes(data: bytes, content_type: str, prefix: str = "images/generated") -> str | None:
    client = _get_client()
    if not client:
        return None
    try:
        ext = _ext_for_content_type(content_type)
        key = _key_for(prefix, ext)
        client.put_object(
            Bucket=settings.r2_bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )
        return _public_url(key)
    except Exception as e:
        print(f"[r2] upload failed: {e}")
        return None

def upload_data_uri(data_uri: str, prefix: str = "images/uploads") -> str | None:
    if not data_uri.startswith("data:"):
        return data_uri if data_uri.startswith("http") else None
    try:
        header, b64 = data_uri.split(",", 1)
        mime = header.split(";")[0].split(":")[1] if ":" in header else "image/jpeg"
        raw = base64.b64decode(b64)
        url = upload_bytes(raw, mime, prefix=prefix)
        return url
    except Exception as e:
        print(f"[r2] data_uri upload failed: {e}")
        return None

def delete_by_url(url: str) -> bool:
    if not url or not _enabled():
        return False
    try:
        ep = settings.r2_endpoint.rstrip("/")
        bucket = settings.r2_bucket_name
        if url.startswith(f"{ep}/{bucket}/"):
            key = url[len(f"{ep}/{bucket}/"):]
        elif bucket in url:
            key = url.split(bucket + "/")[-1].split("?")[0]
        else:
            return False
        client = _get_client()
        client.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        print(f"[r2] delete failed: {e}")
        return False

def presigned_url(key: str, expires: int = 3600) -> str | None:
    client = _get_client()
    if not client:
        return None
    try:
        return client.generate_presigned_url("get_object", Params={"Bucket": settings.r2_bucket_name, "Key": key}, ExpiresIn=expires)
    except Exception:
        return None
