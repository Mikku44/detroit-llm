"""Sliding-window rate limiter keyed by API key / client IP.

Replaces the old sleep-based throttle in main.py which only slowed requests
globally and could not block brute-force attempts. This limiter keeps a
per-bucket sliding window of recent hit timestamps and rejects requests that
exceed the configured limit with HTTP 429.

The limiter is single-process / in-memory, which is correct for the current
single-uvicorn deployment. If the gateway is scaled to multiple workers, the
bucket store should be moved to a shared backend (e.g. Redis).
"""

import hashlib
import time
from collections import defaultdict


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: int = 60):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._clock = time.monotonic

    def _prune(self, key: str, now: float) -> None:
        cutoff = now - self.window
        hits = self._hits[key]
        if hits and hits[0] <= cutoff:
            self._hits[key] = [t for t in hits if t > cutoff]

    def check(self, key: str) -> tuple[bool, int]:
        """Record a hit for `key` and return (allowed, retry_after_seconds).

        If the bucket is already at the limit, the hit is NOT recorded and the
        caller should reject the request.
        """
        now = self._clock()
        self._prune(key, now)
        hits = self._hits[key]
        if len(hits) >= self.limit:
            retry_after = max(1, int(self.window - (now - hits[0])) + 1)
            return False, retry_after
        hits.append(now)
        return True, 0


def bucket_key_for_token(token: str) -> str:
    """Hash the bearer token so the raw key never lingers in memory buckets."""
    return "key:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


rate_limiter = SlidingWindowRateLimiter(limit=60)
