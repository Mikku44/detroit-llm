import httpx

_LLM_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20)
_FETCH_LIMITS = httpx.Limits(max_connections=50, max_keepalive_connections=10)

_llm_client: httpx.AsyncClient | None = None
_fetch_client: httpx.AsyncClient | None = None


def get_llm_client(timeout: float = 300) -> httpx.AsyncClient:
    global _llm_client
    if _llm_client is None or _llm_client.is_closed:
        _llm_client = httpx.AsyncClient(
            limits=_LLM_LIMITS,
            timeout=httpx.Timeout(timeout),
            http2=False,
        )
    else:
        _llm_client.timeout = httpx.Timeout(timeout)
    return _llm_client


def get_fetch_client(timeout: float = 20, follow_redirects: bool = True) -> httpx.AsyncClient:
    global _fetch_client
    if _fetch_client is None or _fetch_client.is_closed:
        _fetch_client = httpx.AsyncClient(
            limits=_FETCH_LIMITS,
            timeout=httpx.Timeout(timeout),
            follow_redirects=follow_redirects,
        )
    else:
        _fetch_client.timeout = httpx.Timeout(timeout)
    return _fetch_client


async def close_clients():
    global _llm_client, _fetch_client
    if _llm_client is not None:
        try:
            await _llm_client.aclose()
        except Exception:
            pass
        _llm_client = None
    if _fetch_client is not None:
        try:
            await _fetch_client.aclose()
        except Exception:
            pass
        _fetch_client = None
