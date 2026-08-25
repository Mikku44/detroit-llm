import logging
import asyncio
import json
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
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/v1/"):
        token = ""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.removeprefix("Bearer ").strip()
        else:
            token = (request.headers.get("x-api-key") or "").strip()
        key = bucket_key_for_token(token) if token else f"ip:{request.client.host if request.client else 'unknown'}"
        allowed, retry_after = rate_limiter.check(key)
        if not allowed:
            return JSONResponse(
                content={"detail": "Rate limit exceeded. Try again later."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
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

    sglang_ok = False
    try:
        client = get_fetch_client(timeout=5)
        r = await client.get(f"{settings.sglang_url}/health")
        sglang_ok = r.status_code == 200
    except Exception:
        pass
    return {"status": "ok", "sglang": sglang_ok, "members_url": settings.members_url}


@app.get("/")
async def root():
    return {
        "name": "Detroit LLM Gateway",
        "version": "0.1.0",
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "auth": "/auth/youtube/login",
            "admin": "/admin/me",
            "health": "/health",
        },
    }
