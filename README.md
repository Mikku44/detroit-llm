# Detroit LLM Gateway

API gateway for `google/gemma-4-26B-A4B` served via SGLang, with YouTube member authentication and usage dashboard.

## Architecture

```
User ──▶ Dashboard (React :5173) ──▶ Gateway (FastAPI :8000) ──▶ SGLang (:30000)
         └── YouTube OAuth ──────▶ members.list ──▶ API key issued
```

## Quick Start

### 1. SGLang server

```bash
# Install
pip install --break-system-packages --force-reinstall --no-deps "sglang[all]"

# Uninstall conflicting packages (if needed)
pip uninstall -y torch torchvision torchaudio sgl-kernel sglang

# Install PyTorch for CUDA 12.4
pip install --break-system-packages torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/torch/lib:$LD_LIBRARY_PATH

# Launch
python3 -m sglang.launch_server \
    --model-path google/gemma-4-26B-A4B \
    --host 0.0.0.0 \
    --port 30000 \
    --mem-fraction-static 0.85 \
    --trust-remote-code
```

### 2. Backend gateway

```bash
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env — fill in:
#   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (Google Cloud OAuth)
#   GOOGLE_API_KEY
#   OWNER_GOOGLE_EMAIL (your channel owner email)
#   JWT_SECRET (generate a random one)
#   DATABASE_URL / CONVERSATIONS_DB_URL (PostgreSQL recommended, SQLite ok for dev)

# Start the gateway
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

#### Migrating from SQLite to PostgreSQL

Set PostgreSQL URLs in `backend/.env`, then run (from the repo root):

```bash
python -m backend.db.migrate_to_postgres
```

This copies users, API keys, usage logs, image usage, and conversations from
`gateway.db` / `conversations.db` into Postgres. Safe to re-run — rows whose
primary key already exists are skipped.

### 3. Dashboard

```bash
cd dashboard

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

## First-time Setup (YouTube Auth)

1. Visit `http://localhost:8000/auth/youtube/login` to authenticate as channel owner
2. This grants the gateway access to `youtube.channelmemberships.creator` scope
3. Users sign in via the dashboard → membership verified → API key issued

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/chat/completions` | API key | OpenAI-compatible chat |
| GET | `/v1/models` | — | List available models |
| GET | `/auth/youtube/login` | — | Owner OAuth |
| GET | `/auth/youtube/login/user` | — | User OAuth |
| POST | `/auth/youtube/verify-members` | — | Sync member list |
| GET | `/admin/me` | API key | Current user info |
| GET | `/admin/keys` | API key | List API keys |
| POST | `/admin/keys` | API key | Create API key |
| DELETE | `/admin/keys/:id` | API key | Revoke API key |
| GET | `/admin/usage?days=7` | API key | Usage stats |
| GET | `/admin/users` | API key (owner) | All users |
| GET | `/health` | — | Health check |

## Usage (OpenAI-compatible client)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="sk-dt-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
)

response = client.chat.completions.create(
    model="google/gemma-4-26B-A4B",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

## Tier limits & usage page

- `/admin/usage/limits` returns the logged-in user's tier (`current_tier_id`),
  the tier's weekly/monthly token budgets and monthly image quota, plus the full
  `TIER_OPTIONS` pricing table. The `/usage` dashboard page renders these bars.
- The gateway enforces the tier's token budget on every `/v1/*` call: a user who
  carries a `tier_id` (Stripe subscription or YouTube level→tier mapping) is
  blocked with `403` once their weekly or monthly usage reaches the tier limit —
  even for owner/member accounts. The windows are **sliding** (last 7 / 30 days),
  so users unblock automatically as old usage ages out.

## Production deployment checklist (สิ่งที่ต้องทำ)

1. Commit the pending changes (tier enforcement, usage page, JSON 400 handler,
   cleanup script, and the uncommitted backend/dashboard work):
   ```bash
   git add -A
   git commit -m "feat: enforce per-tier token limits, cleanup cron, usage page fixes"
   git push
   ```
2. On the VPS, pull and rebuild the stack:
   ```bash
   git pull
   cd /opt/detroit-llm/deploy
   docker compose up -d --build
   docker compose logs -f backend
   ```
3. Install the daily usage-cleanup cronjob (once):
   ```bash
   crontab -e
   # 0 0 * * * cd /opt/detroit-llm/deploy && docker compose exec -T backend python -m backend.scripts.cleanup_usage >> /var/log/detroit-cleanup.log 2>&1
   ```
4. Verify production is healthy:
   ```bash
   curl https://chat.khain.app/health            # expect {"status":"ok",...}
   curl https://chat.khain.app/v1/models          # expect 200
   ```

## Daily usage-log housekeeping (cron)

The per-tier weekly/monthly limits use a sliding window, so users reset
automatically without any job. A cronjob at **00:00 UTC** still prunes usage
logs past the retention window (35 days by default) to keep the database small,
even when nobody sends requests:

```bash
cd /opt/detroit-llm/deploy && docker compose exec -T backend python -m backend.scripts.cleanup_usage
# preview first: add --dry-run
```

See `deploy/README.md` for the full cron setup and retention rationale.
