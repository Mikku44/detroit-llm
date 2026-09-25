// Same-origin Go Gateway by default, with optional Cloudflare edge-first mode.
//
// Default: same origin -> Caddy -> Go Gateway/Python backend.
// Optional: set VITE_API_MODE=cloudflare to use VITE_EDGE_URL first. In that
// mode fallback triggers ONLY on:
//   - network error / edge TTFB timeout (request likely never reached server)
//   - 502 / 503 / 504 from edge (edge couldn't reach backend)
// Never on 4xx/429: retrying a processed mutation (e.g. /stripe/*) could
// duplicate side effects, and 429-fallback would defeat edge rate limiting.
//
// Sticky-failover: after a hard edge failure, skip edge for EDGE_COOLDOWN_MS
// so every call during an outage doesn't pay the timeout cost.

const API_MODE = ((import.meta.env.VITE_API_MODE as string | undefined) || 'go').trim().toLowerCase()

export const EDGE_BASE = API_MODE === 'cloudflare'
  ? ((import.meta.env.VITE_EDGE_URL as string | undefined)?.trim()
    || 'https://detroit-go-gateway.arborrr.workers.dev')
  : ''

const EDGE_TTFB_MS = 8000
const EDGE_COOLDOWN_MS = 30_000

let edgeDownUntil = 0

export function edgeStatus(): { edgeDown: boolean } {
  return { edgeDown: Date.now() < edgeDownUntil }
}

function canRetryBody(body: BodyInit | null | undefined): boolean {
  // String/buffer bodies can be re-sent; one-shot streams cannot.
  return !body || typeof body === 'string' || body instanceof URLSearchParams
    || body instanceof Blob || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
}

// Edge attempt with TTFB-only timeout: the timer is cleared once response
// headers arrive, so long SSE streams are NOT cut off mid-flight.
async function fetchEdge(url: string, init: RequestInit): Promise<Response> {
  const userSignal = init.signal ?? null
  const ctrl = new AbortController()
  let timedOut = false
  const t = setTimeout(() => {
    timedOut = true
    ctrl.abort(new DOMException('edge TTFB timeout', 'TimeoutError'))
  }, EDGE_TTFB_MS)
  const onAbort = () => ctrl.abort(userSignal?.reason)
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort(userSignal.reason)
    else userSignal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (timedOut) throw new Error('edge-timeout')
    throw e
  } finally {
    clearTimeout(t)
    userSignal?.removeEventListener('abort', onAbort)
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // The normal production path is same-origin, where Caddy routes API traffic
  // through the Go Gateway. Do not retry the same request as a fallback.
  if (!EDGE_BASE) return fetch(path, init)

  const edgeFirst = Date.now() >= edgeDownUntil
  const retryable = canRetryBody(init.body as BodyInit | null | undefined)

  if (edgeFirst) {
    try {
      const res = await fetchEdge(`${EDGE_BASE}${path}`, init)
      if (retryable && (res.status === 502 || res.status === 503 || res.status === 504)) {
        // Edge couldn't reach the backend → try VPS direct.
        res.body?.cancel().catch(() => {})
      } else {
        return res
      }
    } catch (e) {
      // User abort must propagate, never "fallback" (would double-fire).
      if (init.signal?.aborted) throw e
      if (!retryable) throw e
      edgeDownUntil = Date.now() + EDGE_COOLDOWN_MS
    }
  }
  return fetch(path, init)
}
