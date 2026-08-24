"""Owner-only balance/credit checks for upstream provider proxies.

Each provider exposes a different balance surface:
  - DeepSeek:  GET {deepseek_url}/user/balance  -> balance_infos[]
  - OpenRouter: GET {openrouter_url}/credits     -> credits_left/total/used
  - DashScope: no public balance REST endpoint via API key alone
  - Gemini:    free tier, no balance endpoint
  - SGLang:    local inference, no account balance
  - Stripe:    GET https://api.stripe.com/v1/balance (available/pending)

Results are never allowed to fail the whole request; each provider is reported
independently with an `error` string when the check could not complete.
"""

import httpx

from backend.config import settings


_TIMEOUT = 10

_PROVIDERS = (
    ("deepseek", "DeepSeek", settings.deepseek_url, settings.deepseek_api_key),
    ("openrouter", "OpenRouter", settings.openrouter_url, settings.openrouter_api_key),
    ("dashscope", "DashScope", settings.dashscope_url, settings.dashscope_api_key),
    ("gemini", "Gemini", settings.gemini_url, settings.gemini_api_key),
)


def _not_configured(provider: str) -> dict:
    return {
        "provider": provider,
        "configured": False,
        "status": "not_configured",
        "balance": None,
        "error": None,
    }


def _unsupported(provider: str, reason: str) -> dict:
    return {
        "provider": provider,
        "configured": True,
        "status": "unsupported",
        "balance": None,
        "error": reason,
    }


def _ok(provider: str, balance) -> dict:
    return {
        "provider": provider,
        "configured": True,
        "status": "ok",
        "balance": balance,
        "error": None,
    }


def _err(provider: str, error: str) -> dict:
    return {
        "provider": provider,
        "configured": True,
        "status": "error",
        "balance": None,
        "error": error,
    }


async def _deepseek_balance(url: str, api_key: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{url.rstrip('/')}/user/balance", headers=headers)
        if r.status_code >= 400:
            return _err("deepseek", f"HTTP {r.status_code}: {r.text[:200]}")
        data = r.json()
        infos = [
            {
                "currency": info.get("currency"),
                "total_balance": info.get("total_balance"),
                "granted_balance": info.get("granted_balance"),
                "topped_up_balance": info.get("topped_up_balance"),
            }
            for info in (data.get("balance_infos") or [])
            if isinstance(info, dict)
        ]
        return _ok("deepseek", {"available": bool(data.get("is_available")), "balance_infos": infos})
    except httpx.HTTPError as e:
        return _err("deepseek", f"{type(e).__name__}: {e}")


async def _openrouter_balance(url: str, api_key: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{url.rstrip('/')}/credits", headers=headers)
        if r.status_code >= 400:
            return _err("openrouter", f"HTTP {r.status_code}: {r.text[:200]}")
        data = r.json()
        inner = data.get("data") if isinstance(data.get("data"), dict) else data
        total = inner.get("total_credits")
        used = inner.get("total_usage")
        left = None
        if isinstance(total, (int, float)) and isinstance(used, (int, float)):
            left = round(total - used, 4)
        return _ok(
            "openrouter",
            {
                "credits_total": total,
                "credits_used": used,
                "credits_left": left,
            },
        )
    except httpx.HTTPError as e:
        return _err("openrouter", f"{type(e).__name__}: {e}")


async def _stripe_balance(api_key: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get("https://api.stripe.com/v1/balance", headers=headers)
        if r.status_code >= 400:
            return _err("stripe", f"HTTP {r.status_code}: {r.text[:200]}")
        data = r.json()
        return _ok(
            "stripe",
            {
                "available": [
                    {"currency": b.get("currency"), "amount": b.get("amount")}
                    for b in (data.get("available") or [])
                    if isinstance(b, dict)
                ],
                "pending": [
                    {"currency": b.get("currency"), "amount": b.get("amount")}
                    for b in (data.get("pending") or [])
                    if isinstance(b, dict)
                ],
            },
        )
    except httpx.HTTPError as e:
        return _err("stripe", f"{type(e).__name__}: {e}")


async def check_provider_balances() -> dict:
    """Query every configured upstream and return a provider -> result map."""
    results = {}

    for key, _name, url, api_key in _PROVIDERS:
        if not api_key:
            results[key] = _not_configured(key)
            continue
        if key == "deepseek":
            results[key] = await _deepseek_balance(url, api_key)
        elif key == "openrouter":
            results[key] = await _openrouter_balance(url, api_key)
        else:
            # DashScope / Gemini: no public balance endpoint.
            reason = {
                "dashscope": "DashScope has no public balance endpoint via API key",
                "gemini": "Gemini is free tier; no balance endpoint",
            }[key]
            results[key] = _unsupported(key, reason)

    if settings.sglang_url:
        results["sglang"] = _ok("sglang", {"url": settings.sglang_url, "note": "local inference, no account balance"})

    if settings.stripe_api_key:
        results["stripe"] = await _stripe_balance(settings.stripe_api_key)
    else:
        results["stripe"] = _not_configured("stripe")

    return results
