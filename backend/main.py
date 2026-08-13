import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.db.database import init_db
from backend.proxy.router import router as proxy_router
from backend.auth.youtube import router as youtube_router
from backend.admin.router import router as admin_router
from backend.chat.router import router as chat_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Detroit LLM Gateway", version="0.1.0", lifespan=lifespan)

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
        import asyncio
        rate = getattr(request.state, "_rate_limit", settings.rate_limit_per_minute)
        sleep_time = 60.0 / rate
        await asyncio.sleep(sleep_time)
    response = await call_next(request)
    return response


app.include_router(youtube_router)
app.include_router(admin_router)
app.include_router(proxy_router)
app.include_router(chat_router)


@app.get("/health")
async def health():
    import httpx
    sglang_ok = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
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
