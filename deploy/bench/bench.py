"""
bench.py — Compare Python (FastAPI :8000) vs Go (:8080) edge gateway.

Usage:
  pip install httpx
  python deploy/bench/bench.py --url http://localhost:8080 --url2 http://localhost:8000 --concurrency 50 --requests 2000

Hits: /health, /v1/models (cached), /v1/chat/completions (mock fallback)
"""
import argparse, asyncio, time, statistics
import httpx

ENDPOINTS = [
    ("/health", "GET", None),
    ("/v1/models", "GET", None),
    ("/v1/chat/completions", "POST", {"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "ping"}], "stream": False}),
]

async def hit(client, base, path, method, body):
    url = base + path
    t0 = time.perf_counter()
    try:
        if method == "GET":
            r = await client.get(url, headers={"Authorization": "Bearer sk-dt-bench"})
        else:
            r = await client.post(url, json=body, headers={"Authorization": "Bearer sk-dt-bench", "Content-Type": "application/json"})
        lat = (time.perf_counter() - t0) * 1000
        return lat, r.status_code
    except Exception:
        return (time.perf_counter() - t0) * 1000, 0

async def bench_one(base, concurrency, total, path, method, body):
    limits = httpx.Limits(max_connections=concurrency*2, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(timeout=10, limits=limits) as client:
        sem = asyncio.Semaphore(concurrency)
        lats = []
        codes = {}
        async def task():
            async with sem:
                lat, code = await hit(client, base, path, method, body)
                lats.append(lat)
                codes[code] = codes.get(code, 0) + 1
        t0 = time.perf_counter()
        await asyncio.gather(*(task() for _ in range(total)))
        elapsed = time.perf_counter() - t0
        lats.sort()
        def pct(p): return lats[int(len(lats)*p/100)] if lats else 0
        return {
            "rps": total / elapsed if elapsed else 0,
            "p50": pct(50), "p95": pct(95), "p99": pct(99),
            "mean": statistics.mean(lats) if lats else 0,
            "codes": codes, "elapsed": elapsed,
        }

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080", help="Go gateway")
    ap.add_argument("--url2", default="http://localhost:8000", help="Python backend")
    ap.add_argument("--concurrency", type=int, default=50)
    ap.add_argument("--requests", type=int, default=2000)
    args = ap.parse_args()
    for label, base in [("Go :8080", args.url), ("Python :8000", args.url2)]:
        print(f"\n== {label} ({base}) c={args.concurrency} n={args.requests} ==")
        print(f"{'endpoint':<28} {'rps':>7} {'mean':>7} {'p50':>7} {'p95':>7} {'p99':>7}  codes")
        for path, method, body in ENDPOINTS:
            r = await bench_one(base, args.concurrency, args.requests, path, method, body)
            print(f"{path:<28} {r['rps']:7.0f} {r['mean']:7.1f} {r['p50']:7.1f} {r['p95']:7.1f} {r['p99']:7.1f}  {r['codes']}")

if __name__ == "__main__":
    asyncio.run(main())
