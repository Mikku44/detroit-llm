import time

from backend.ratelimit import SlidingWindowRateLimiter, bucket_key_for_token


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_allows_requests_up_to_limit():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
    limiter._clock = clock

    for _ in range(3):
        allowed, _ = limiter.check("k1")
        assert allowed is True


def test_rejects_over_limit_and_reports_retry_after():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
    limiter._clock = clock

    for _ in range(3):
        limiter.check("k1")
    allowed, retry_after = limiter.check("k1")
    assert allowed is False
    assert retry_after > 0


def test_buckets_are_independent():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=60)
    limiter._clock = clock

    limiter.check("a")
    limiter.check("a")
    allowed_b, _ = limiter.check("b")
    assert allowed_b is True

    allowed_a, _ = limiter.check("a")
    assert allowed_a is False


def test_window_slides_after_expiry():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=10)
    limiter._clock = clock

    limiter.check("k")
    limiter.check("k")
    assert limiter.check("k")[0] is False

    clock.now = 11.0  # window expired
    allowed, _ = limiter.check("k")
    assert allowed is True


def test_bucket_key_hashes_token():
    assert bucket_key_for_token("sk-dt-abc") == bucket_key_for_token("sk-dt-abc")
    assert bucket_key_for_token("sk-dt-abc") != bucket_key_for_token("sk-dt-other")
    assert not bucket_key_for_token("sk-dt-abc").startswith("sk-dt-")


def test_middleware_429_on_exceeded_limit(client, api_key, monkeypatch):
    from backend.main import rate_limiter as _original

    fresh = SlidingWindowRateLimiter(limit=2, window_seconds=60)
    monkeypatch.setattr("backend.main.rate_limiter", fresh)

    headers = {"Authorization": f"Bearer {api_key}"}
    payload = {"messages": [{"role": "user", "content": "hi"}]}

    r1 = client.post("/v1/chat/completions", json=payload, headers=headers)
    r2 = client.post("/v1/chat/completions", json=payload, headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200

    r3 = client.post("/v1/chat/completions", json=payload, headers=headers)
    assert r3.status_code == 429
    assert "Rate limit exceeded" in r3.json()["detail"]
    assert "Retry-After" in r3.headers
