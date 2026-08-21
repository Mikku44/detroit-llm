from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get the directory where this settings.py file is located
BASE_DIR = Path(__file__).resolve().parent

class Settings(BaseSettings):
    sglang_url: str = "http://localhost:30000"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    conversations_db_url: str = "sqlite+aiosqlite:///./conversations.db"

    deepseek_url: str = "https://api.deepseek.com"
    deepseek_api_key: str = ""

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_url: str = "https://generativelanguage.googleapis.com/v1beta"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_api_key: str = ""

    owner_google_email: str = ""
    owner_refresh_token: str = ""

    jwt_secret: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    session_ttl_seconds: int = 60 * 60 * 24 * 7

    dashboard_url: str = "http://localhost:5173"
    redirect_uri: str = "http://localhost:8000/auth/youtube/callback"

    members_url: str = ""

    # Image generation provider: "loremflickr" (default, free, no key) | "unsplash" (needs access key) | "auto" | "mock" (offline)
    image_provider: str = "loremflickr"
    unsplash_access_key: str = ""

    rate_limit_per_minute: int = 60

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
        "deepseek_cost": "5.62฿",
        "profit": "29.38฿",
        "margin": "83.9%",
    },
    {
        "id": "dreamer",
        "emoji": "🔵",
        "name": "Dreamer",
        "price": "75฿",
        "net": "52.5฿",
        "weekly": 1000000,
        "monthly": 4350000,
        "deepseek_cost": "11.25฿",
        "profit": "41.25฿",
        "margin": "78.6%",
    },
    {
        "id": "entrepreneur",
        "emoji": "🟣",
        "name": "Entrepreneur",
        "price": "300฿",
        "net": "210฿",
        "weekly": 3000000,
        "monthly": 13040000,
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
        "deepseek_cost": "112.53฿",
        "profit": "937.47฿",
        "margin": "89.3%",
    },
]


settings = Settings()