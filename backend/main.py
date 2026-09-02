import logging
import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.db.database import init_db
from backend.proxy.router import router as proxy_router
from backend.auth.youtube import router as youtube_router
from backend.auth.members import start_sync_task
from backend.admin.router import router as admin_router
from backend.chat.router import router as chat_router
from backend.chat.conversations import router as conversations_router
from backend.stripe.router import router as stripe_router
from backend.ratelimit import SlidingWindowRateLimiter, bucket_key_for_token

rate_limiter = SlidingWindowRateLimiter(limit=settings.rate_limit_per_minute)
health_limiter = SlidingWindowRateLimiter(limit=30, window_seconds=60)
auth_limiter = SlidingWindowRateLimiter(limit=10, window_seconds=60)
_health_cache: dict = {"ok": False, "at": 0.0}
MAX_BODY_BYTES = 1 << 20

def _client_ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h) or request.headers.get(h.title())
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logging.getLogger("uvicorn.error").info(
        "Gemini vision configured: %s", bool(settings.gemini_api_key)
    )
    member_sync_task = await start_sync_task()
    try:
        yield
    finally:
        member_sync_task.cancel()
        try:
            await member_sync_task
        except asyncio.CancelledError:
            pass
        try:
            from backend.http import close_clients

            await close_clients()
        except Exception:
            pass


app = FastAPI(title="Detroit LLM Gateway", version="0.1.0", lifespan=lifespan)


@app.exception_handler(json.JSONDecodeError)
async def _invalid_json_handler(request: Request, exc: json.JSONDecodeError):
    return JSONResponse(status_code=400, content={"detail": "Request body must be valid JSON."})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.dashboard_url, "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Gateway", "X-Handler", "X-Served-By", "X-Response-Time", "X-Gateway-Version"],
)


@app.middleware("http")
async def body_limit_middleware(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Payload too large (max 1MB)"})
    return await call_next(request)


@app.middleware("http")
async def gateway_header_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Gateway"] = "fastapi"
    response.headers["X-Gateway-Version"] = "0.1.0"
    response.headers["X-Handler"] = f"fastapi:{request.url.path}"
    response.headers["X-Response-Time"] = f"{(time.perf_counter() - start) * 1000:.1f}ms"
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if os.getenv("PYTEST_CURRENT_TEST") and not path.startswith("/v1/"):
        return await call_next(request)
    limiter = None
    if path.startswith("/v1/"):
        limiter = rate_limiter
    elif path.startswith(("/health", "/admin/", "/api/")):
        limiter = health_limiter
    elif path.startswith(("/auth/", "/stripe/")):
        limiter = auth_limiter
    if limiter is not None:
        token = ""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.removeprefix("Bearer ").strip()
        else:
            token = (request.headers.get("x-api-key") or "").strip()
        key = bucket_key_for_token(token) if token else f"ip:{_client_ip(request)}"
        allowed, retry_after = limiter.check(key)
        if not allowed:
            return JSONResponse(
                content={"detail": "Rate limit exceeded. Try again later."},
                status_code=429,
                headers={"Retry-After": str(retry_after), "X-Gateway": "fastapi", "X-Handler": "rate-limit"},
            )
    response = await call_next(request)
    return response

app.include_router(youtube_router)
app.include_router(admin_router)
app.include_router(proxy_router)
app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(stripe_router)


@app.get("/health")
async def health():
    from backend.http import get_fetch_client

    now = time.monotonic()
    if now - _health_cache["at"] < 5:
        return {"status": "ok", "sglang": _health_cache["ok"], "gateway": "fastapi"}
    sglang_ok = _health_cache["ok"]
    try:
        client = get_fetch_client(timeout=1)
        r = await client.get(f"{settings.sglang_url}/health")
        sglang_ok = r.status_code == 200
        _health_cache["ok"] = sglang_ok
        _health_cache["at"] = now
    except Exception:
        pass
    return {"status": "ok", "sglang": sglang_ok, "gateway": "fastapi"}


@app.get("/")
async def root():
    return {
        "name": "Detroit LLM Gateway",
        "version": "0.1.0",
        "gateway": "fastapi",
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "auth": "/auth/youtube/login",
            "admin": "/admin/me",
            "health": "/health",
        },
    }
