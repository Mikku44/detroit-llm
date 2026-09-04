from pathlib import Path
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get the directory where this settings.py file is located
BASE_DIR = Path(__file__).resolve().parent

class Settings(BaseSettings):
    sglang_url: str = "http://localhost:30000"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    conversations_db_url: str = "sqlite+aiosqlite:///./conversations.db"

    # Persistent data directory (members.json, owner refresh token, etc).
    # In Docker this is mounted at /data. Defaults to ./data next to the repo.
    data_dir: str = ""

    deepseek_url: str = "https://api.deepseek.com"
    deepseek_api_key: str = ""

    # Alibaba Cloud DashScope (international) — Qwen models via OpenAI-compatible mode.
    dashscope_url: str = "https://dashscope-intl.aliyuncs.com"
    dashscope_api_key: str = ""

    # OpenRouter — proxies many models via OpenAI-compatible API.
    # Accepts both OPENROUTER_API_KEY and OPEN_ROUTER_API_KEY spellings.
    openrouter_url: str = "https://openrouter.ai/api/v1"
    openrouter_api_key: str = Field(
        default="", validation_alias=AliasChoices("OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY")
    )

    z_api_key: str = Field(default="", validation_alias=AliasChoices("Z_API_KEY", "ZAI_API_KEY"))
    z_ai_url: str = "https://api.z.ai/api/paas/v4"

    anthropic_api_key: str = Field(default="", validation_alias=AliasChoices("ANTHROPIC_API_KEY", "ANTHROPIC_KEY", "CLAUDE_API_KEY"))
    anthropic_api_url: str = "https://api.anthropic.com"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_url: str = "https://generativelanguage.googleapis.com/v1beta"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_api_key: str = ""

    owner_google_email: str = ""
    owner_refresh_token: str = ""

    # Fallback member list: a JSON file holding member channel IDs. When the
    # YouTube members API is unavailable (no OAuth permission in Google Cloud
    # Console), membership checks read from this file instead.
    members_json_path: str = ""

    # Auto-sync: refresh the member list from YouTube and update user flags.
    # Interval in seconds (default 5 min). Falls back to members_json_path.
    members_sync_interval_seconds: int = 300

    jwt_secret: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    # Optional separate key for encrypting sensitive values (e.g. raw API keys)
    # at rest. If unset, derived from JWT_SECRET. Set a random 32+ char value.
    encryption_key: str = ""
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    dashboard_url: str = "http://localhost:5173"
    redirect_uri: str = "http://localhost:8000/auth/youtube/callback"

    members_url: str = ""

    # Image generation provider: "auto" (grok -> zai -> dashscope -> unsplash -> loremflickr) — default
    # | "grok" (xAI Grok Imagine, needs GROK_API_KEY) | "dashscope" (z-image-turbo)
    # | "unsplash" | "loremflickr"
    image_provider: str = "auto"
    unsplash_access_key: str = ""
    grok_api_key: str = Field(default="", validation_alias=AliasChoices("GROK_API_KEY", "XAI_API_KEY"))
    grok_api_url: str = "https://api.x.ai/v1"
    grok_image_model: str = "grok-imagine-image"

    rate_limit_per_minute: int = 60

    r2_account_id: str = ""
    r2_bucket_name: str = "detroit-llm-storage"
    r2_endpoint: str = ""
    r2_region: str = "auto"
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_public_url: str = ""

    stripe_api_key: str = ""
    stripe_webhook_secret: str = ""

    # Free-tier weekly/monthly token budget (total input+output tokens).
    free_weekly_tokens: int = 100000
    free_monthly_tokens: int = 435000

    model_config = SettingsConfigDict(
        # Points specifically to .env in your project folder
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


# Tier pricing table (drives the /admin/usage/limits response and the
# Usage page). weekly/monthly are total token budgets per period.
TIER_OPTIONS = [
    {
        "id": "free",
        "emoji": "🆓",
        "name": "Free",
        "price": "0฿",
        "net": "0฿",
        "weekly": 100000,
        "monthly": 435000,
        "image_quota": 2,
        "deepseek_cost": "1.13฿",
        "profit": "-1.13฿",
        "margin": "—",
    },
    {
        "id": "nomad",
        "emoji": "🟢",
        "name": "Nomad",
        "price": "50฿",
        "net": "35฿",
        "weekly": 500000,
        "monthly": 2170000,
        "image_quota": 10,
        "deepseek_cost": "5.62฿",
        "profit": "29.38฿",
        "margin": "83.9%",
    },
    {
        "id": "nomad_extra_claude",
        "emoji": "🟢",
        "name": "Nomad (Extra Claude)",
        "price": "49฿",
        "net": "34.3฿",
        "weekly": 90000,
        "monthly": 360000,
        "image_quota": 10,
        "deepseek_cost": "1.95฿",
        "profit": "32.35฿",
        "margin": "94.3%",
        "input_tokens": 300000,
        "output_tokens": 60000,
        "concurrent_requests": 2,
        "direct_only": True,
        "models": ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-5", "claude-fable-5-1"],
    },
    {
        "id": "dreamer",
        "emoji": "🔵",
        "name": "Dreamer",
        "price": "75฿",
        "net": "52.5฿",
        "weekly": 1000000,
        "monthly": 4350000,
        "image_quota": 20,
        "deepseek_cost": "11.25฿",
        "profit": "41.25฿",
        "margin": "78.6%",
    },
    {
        "id": "dreamer_extra_claude",
        "emoji": "🤖",
        "name": "Dreamer (Extra Claude)",
        "price": "99฿",
        "net": "69.3฿",
        "weekly": 32000,
        "monthly": 128000,
        "image_quota": 20,
        "deepseek_cost": "0.83฿",
        "profit": "68.47฿",
        "margin": "98.8%",
        "input_tokens": 100000,
        "output_tokens": 28000,
        "concurrent_requests": 2,
        "direct_only": True,
        "models": ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-5", "claude-fable-5-1"],
    },
    {
        "id": "entrepreneur",
        "emoji": "🟣",
        "name": "Entrepreneur",
        "price": "300฿",
        "net": "210฿",
        "weekly": 3000000,
        "monthly": 13040000,
        "image_quota": 50,
        "deepseek_cost": "33.78฿",
        "profit": "176.22฿",
        "margin": "83.9%",
    },
    {
        "id": "angel",
        "emoji": "🟡",
        "name": "Angel Investor",
        "price": "1,500฿",
        "net": "1,050฿",
        "weekly": 10000000,
        "monthly": 43450000,
        "image_quota": 150,
        "deepseek_cost": "112.53฿",
        "profit": "937.47฿",
        "margin": "89.3%",
    },
]


settings = Settings()


def _assert_secure_secrets() -> None:
    """Fail fast on insecure secret configuration.

    Prevents running with a default/weak JWT secret, which would let anyone
    forge dashboard session tokens.
    """
    weak = (
        not settings.jwt_secret
        or settings.jwt_secret == "change-me-to-a-random-secret"
        or len(settings.jwt_secret) < 32
    )
    if weak:
        raise RuntimeError(
            "JWT_SECRET is missing or too weak. Set a strong random secret "
            "(>= 32 chars) in backend/.env before starting."
        )


_assert_secure_secrets()