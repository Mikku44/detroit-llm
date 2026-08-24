# Deploy Detroit LLM Gateway (Docker Compose)

Production stack: **Caddy** (HTTPS + static frontend + reverse proxy) + **FastAPI backend** (uvicorn) + **PostgreSQL** + **Caddy** (certs).

## Prerequisites
- VPS: Ubuntu 24.04, 1 vCPU / 2 GiB / 25 GiB (add 2 GB swap for safety)
- Domain `chat.khain.app` → point an `A` record to the VPS IP
- Ports 80/443 open (Caddy gets Let's Encrypt certs automatically)

## 1. Install Docker on the VPS
```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo apt install -y docker-compose-plugin
```

## 2. Upload the project
Copy the repo to the VPS (excluding `node_modules`, `.git`, local DBs):
```bash
# on your machine
rsync -av --exclude node_modules --exclude .git --exclude dashboard/node_modules ./ user@YOUR_VPS:/opt/detroit-llm/
```

## 3. Configure the environment
```bash
cd /opt/detroit-llm/deploy
cp .env.example .env
nano .env
```
Fill in real values:
- `POSTGRES_USER` / `POSTGRES_PASSWORD` (run `openssl rand -hex 16`)
- `DATABASE_URL` / `CONVERSATIONS_DB_URL` pointing at the `postgres` service
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_API_KEY`
- `OWNER_GOOGLE_EMAIL` / `OWNER_REFRESH_TOKEN`
- `JWT_SECRET` (run `openssl rand -hex 32`)
- `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`
- `DASHBOARD_URL=https://chat.khain.app`
- `REDIRECT_URI=https://chat.khain.app/auth/youtube/callback`

## 4. Google OAuth — update redirect URI
In Google Cloud Console → Credentials → OAuth client:
add `https://chat.khain.app/auth/youtube/callback` to **Authorized redirect URIs**.

## 5. Build & start
```bash
cd /opt/detroit-llm/deploy
docker compose up -d --build
docker compose logs -f backend   # watch for errors
```

### Using the bundled Postgres (self-hosted)
If you don't have a managed DB, enable the `selfhosted` profile to also start
the bundled PostgreSQL (creates `detroit` + `detroit_conversations` databases):
```bash
docker compose --profile selfhosted up -d --build
```
With a managed DB (Neon/Supabase), leave `postgres` out — just set
`DATABASE_URL` / `CONVERSATIONS_DB_URL` to your cloud URLs.

## 6. Verify
- https://chat.khain.app → login page
- https://chat.khain.app/health → `{"status":"ok",...}`
- API key + curl: `POST https://chat.khain.app/v1/chat/completions`

## Persistent data
All runtime data lives on Docker volumes (survives `up -d`/rebuilds):
- `pg-data` — PostgreSQL databases
- `app-data` (mounted at `/data`) — `members.json`, owner OAuth refresh token
- `caddy-data` / `caddy-config` — TLS certs + Caddy config

Backup (Postgres):
```bash
docker compose exec postgres pg_dump -U detroit -d detroit > backup.sql
docker compose exec postgres pg_dump -U detroit -d detroit_conversations > backup_conversations.sql
```

## Update
```bash
git pull
cd deploy && docker compose up -d --build
```

## Scaling note
- `RATE_LIMIT_PER_MINUTE` and free-tier budgets are in `.env`.
- The in-memory rate limiter means **run 1 backend container** only. For more capacity, move the limiter to Redis.
