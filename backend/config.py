from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get the directory where this settings.py file is located
BASE_DIR = Path(__file__).resolve().parent

class Settings(BaseSettings):
    sglang_url: str = "http://localhost:30000"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"

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

    model_config = SettingsConfigDict(
        # Points specifically to .env in your project folder
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()