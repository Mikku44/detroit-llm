#!/usr/bin/env bash
set -e
CONCURRENCY=${1:-50}
REQUESTS=${2:-2000}
GO_URL=${GO_URL:-http://localhost:8080}
PY_URL=${PY_URL:-http://localhost:8000}

echo "== wrk/hey fallback: install hey with: go install github.com/rakyll/hey@latest =="

if command -v hey >/dev/null 2>&1; then
  echo "--- hey Go  /health ---"
  hey -c $CONCURRENCY -n $REQUESTS "$GO_URL/health" || true
  echo "--- hey Python /health ---"
  hey -c $CONCURRENCY -n $REQUESTS "$PY_URL/health" || true
  echo "--- hey Go  /v1/models ---"
  hey -c $CONCURRENCY -n $REQUESTS -H "Authorization: Bearer sk-dt-bench" "$GO_URL/v1/models" || true
  echo "--- hey Python /v1/models ---"
  hey -c $CONCURRENCY -n $REQUESTS -H "Authorization: Bearer sk-dt-bench" "$PY_URL/v1/models" || true
elif command -v wrk >/dev/null 2>&1; then
  wrk -t4 -c$CONCURRENCY -d10s "$GO_URL/health" || true
  wrk -t4 -c$CONCURRENCY -d10s "$PY_URL/health" || true
else
  echo "hey/wrk not found, falling back to Python bench"
  python deploy/bench/bench.py --url "$GO_URL" --url2 "$PY_URL" --concurrency $CONCURRENCY --requests $REQUESTS
fi
