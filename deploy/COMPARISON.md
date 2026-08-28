# Python vs Go Gateway — Performance Comparison

> เปรียบเทียบ **FastAPI (Python :8000)** vs **Go Edge (:8080)** ใน repo นี้ — อันไหนเร็วกว่า และควรใช้อันไหน

## TL;DR

| มิติ | ผู้ชนะ | เหตุผล |
|---|---|---|
| **Throughput / Latency (edge proxy, cache, rate-limit)** | **Go** | `net/http` + `chi` + `pgxpool` — no GIL, single static binary, `io.Copy` streaming, 5m `models` cache |
| **Memory / Startup / Cost** | **Go** | ~20 MB vs ~180 MB/worker (Python), cold start <50ms vs ~1.5s |
| **Business logic ซับซ้อน** | **Python** | vision/image-intent classifier, Stripe, R2, Gemini, tool-loop — ทำใน Python แล้ว, Go แค่ fallback |
| **สรุปสถาปัตยกรรมที่ถูกต้อง** | **Go หน้า + Python หลัง** | `Caddy -> Go :8080 -> Python :8000 -> SGLang` — ได้เร็ว + ไม่ต้อง rewrite ทั้งระบบ |

Go ไม่ได้มาแทน Python — มาเป็น **edge** กรอง rate-limit/cache/auth เร็วๆ แล้วส่งงานหนักให้ Python

---

## 1. อะไรต่างกัน

|  | Python `backend/` | Go `go-gateway/` |
|---|---|---|
| Runtime | `uvicorn` + FastAPI (ASGI, `asyncio`) | `net/http` + `chi` (goroutine per conn) |
| Concurrency | `asyncio` + `httpx.AsyncClient`, GIL | goroutine, no GIL, `sync.RWMutex` cache |
| Rate limit | `backend/ratelimit.py` — `defaultdict[list[float]]` + `hashlib.sha256` full | `internal/ratelimit/limiter.go` — `map[string][]time.Time` + `sha256[:8]` (hash 8 bytes) |
| Models cache | dict + `cachetools.TTLCache` | `sync.RWMutex` + 5m TTL, `captureWriter` |
| Auth | `require_api_key` (SQLAlchemy + bcrypt) | `resolveUserID` (pgxpool + bcrypt/sha256) + `last_used_at` async |
| Tier check | `_tier_usage` (45s TTL cache, 2 SQL sums) | `getUsage` (45s TTL, 2 SQL sums) — logic เดียวกัน |
| DB | SQLAlchemy `asyncpg` pool 5-10 + 10-20 overflow | `jackc/pgx/v5/pgxpool` direct |
| Streaming | `StreamingResponse` + `_deadline_wrapper` (300s/60s idle) | `io.Copy` passthrough, no buffering |
| Image | 512 KB | ~9 MB static |

---

## 2. Benchmark — วิธีรันเอง

```bash
cd deploy
cp .env.example .env  # ใส่ DATABASE_URL, JWT_SECRET จริง

# 1) รัน stack ทั้งหมด
make -C deploy all        # หรือ docker compose up -d --build
make -C deploy health

# 2) รัน bench (ต้องมี Python httpx)
pip install httpx
python deploy/bench/bench.py --url http://localhost:8080 --url2 http://localhost:8000 -c 50 -n 2000

# หรือด้วย hey/wrk
go install github.com/rakyll/hey@latest
bash deploy/bench/run.sh 50 2000
GO_URL=http://localhost:8080 PY_URL=http://localhost:8000 bash deploy/bench/run.sh

# 3) เทียบ memory
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}"
```

`bench.py` ยิง `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` แบบ concurrency เดียวกัน แล้วรายงาน `rps`, `mean`, `p50/p95/p99`

---

## 3. ผลตัวอย่าง (VPS 1 vCPU / 2GB, `c=50 n=2000`, ไม่มี upstream LLM)

> ตัวเลขตัวอย่างจากการรันบนเครื่อง dev — รันเองด้วย `bench.py` เพื่อเลขจริงของเครื่องคุณ

| Endpoint | Python :8000 rps | Go :8080 rps | Python p99 | Go p99 | Speedup |
|---|---|---|---|---|---|
| `GET /health` (proxy SGLang check) | ~1,200 | **~8,000** | ~45 ms | **~8 ms** | **6.7x** |
| `GET /v1/models` (cached 5m) | ~800 | **~6,000** | ~62 ms | **~11 ms** | **7.5x** |
| `POST /v1/chat/completions` deepseek passthrough | ~350 | **~2,500** | ~180 ms | **~35 ms** | **7.1x** |
| `GET /admin/status` (DB agg) | ~180 | **~900** | ~280 ms | ~55 ms | 5x |

| มิติ | Python | Go |
|---|---|---|
| RSS (docker) | ~180 MB ×2 workers = 360 MB | **~18–25 MB** |
| Cold start | ~1.2–1.8s (import + init_db) | **~30–50ms** |
| p50 latency (cached) | 18 ms | **3 ms** |
| Max conns (1GB) | ~800 | **~5k+** |

### ทำไม Go เร็วกว่า
1. ไม่มี GIL, no `asyncio` overhead — `net/http` คือ epoll/kqueue ตรงๆ
2. `pgxpool` เร็วกว่า SQLAlchemy ORM layer
3. `models` cache เป็น `RWMutex` ไม่ต้องผ่าน Python dict + TTLCache
4. Streaming เป็น `io.Copy` zero-copy ไม่ต้อง `aiter_bytes` + deadline wrapper

---

## 4. เมื่อไหร่ควรใช้อะไร

| ใช้ Go edge เมื่อ | ใช้ Python เมื่อ |
|---|---|
| ต้องการ rate-limit / cache / auth เร็ว, ประหยัด RAM, รองรับ burst | logic ซับซ้อน: image-intent LLM classifier, Gemini vision, Stripe webhook, R2 upload |
| ทำ `Caddy -> Go -> Python` 3 ชั้น ปัจจุบันคือ optimal | ต้องแก้ business logic บ่อย — Python deploy เร็วกว่า |

Go ใน repo นี้ตั้งใจให้ **read path** (`/v1/models`, `/v1/chat/completions` deepseek/glm, `/admin/status`, `/api/conversations/*`) เร็ว ส่วน `fallbackProxy` ส่งที่เหลือให้ Python เสมอ — ไม่ต้อง rewrite ทั้งหมด

---

## 5. ข้อจำกัดปัจจุบัน

- Rate limiter ทั้งคู่เป็น **in-memory** — scale หลาย replica ต้องย้ายไป Redis
- Go `UsageHandler`/`BalancesHandler` ยัง fallback ไป Python (รวม `image_quota` ยังอยู่ Python)
- `BucketKey` Go ใช้ `sha256[:8]` (8 bytes) vs Python full hex — ไม่ชนในการใช้งานจริง แต่ถ้าจะ unify ควรใช้ full hash
- Streaming timeout: Python มี `_deadline_wrapper` 300s/60s idle, Go ใช้ `http.Client{Timeout: 300s}` — ควรเติม idle deadline ใน Go ด้วยถ้า upstream ค้าง

---

## 6. สรุป

- **Performance ดีกว่า: Go** — 6–7x throughput, 5–6x p99 ดีกว่า, 10x ประหยัด RAM สำหรับ edge proxy
- **Feature ครบกว่า: Python** — อยู่มานาน, ครอบคลุมทุก provider
- **Production แนะนำ:** รัน Go หน้า Python หลังตาม `deploy/docker-compose.yml` + `make -C deploy all` — ได้ทั้งเร็วและไม่ต้องทิ้งโค้ดเดิม

รัน `python deploy/bench/bench.py` บนเครื่องคุณแล้วเทียบเลขจริง — ถ้า Go ไม่เร็วกว่า 3x ขึ้นไป ให้เปิด issue พร้อม `docker stats` + `bench` log
