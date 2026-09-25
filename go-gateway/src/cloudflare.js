// Pure Worker edge proxy (free tier, no Containers / Durable Objects).
// Mirrors go-gateway routing: rate-limit + /v1/models cache + passthrough
// everything else to BACKEND_URL (VPS). Tier enforcement stays in Python.
const VERSION = "0.2.0-cf-worker";
const MODELS_TTL = 300; // seconds

// In-memory sliding-window buckets (per isolate, best-effort at edge;
// exact enforcement still happens in the Python backend).
const buckets = new Map();
function allowed(key, limit) {
  const now = Date.now();
  const window = 60_000;
  let arr = buckets.get(key);
  if (!arr) {
    arr = [];
    buckets.set(key, arr);
  }
  while (arr.length && now - arr[0] > window) arr.shift();
  if (arr.length >= limit) return { ok: false, retry: Math.ceil((arr[0] + window - now) / 1000) };
  arr.push(now);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return { ok: true };
}

function bucketKey(req) {
  const h = req.headers.get("authorization");
  if (h && h.startsWith("Bearer ")) return "tok:" + h.slice(7, 47);
  if (req.headers.get("x-api-key")) return "tok:" + req.headers.get("x-api-key").slice(0, 40);
  return "ip:" + (req.headers.get("CF-Connecting-IP") || "unknown");
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const dash = env.DASHBOARD_URL || "";
  const allow =
    origin === "http://localhost:5173" || origin === "http://localhost:5174" || (dash && origin === dash)
      ? origin
      : dash;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "X-Gateway, X-Handler, X-Served-By, X-Response-Time, X-Gateway-Version",
  };
}

function baseHeaders(handler) {
  return {
    "X-Gateway": "cf-worker",
    "X-Gateway-Version": VERSION,
    "X-Via": "cf-worker",
    "X-Handler": handler,
  };
}

function json(data, status = 200, handler = "worker", req, env, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...baseHeaders(handler),
      ...corsHeaders(req, env),
      ...extra,
    },
  });
}

async function proxy(req, env, handler, handlerName) {
  const backend = (env.BACKEND_URL || "").replace(/\/$/, "");
  if (!backend) return json({ detail: "BACKEND_URL not configured" }, 500, handlerName, req, env);
  const url = new URL(req.url);
  const target = backend + url.pathname + url.search;
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  let resp;
  try {
    resp = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual",
    });
  } catch {
    return json({ detail: "backend unavailable, fallback" }, 502, handlerName, req, env);
  }
  const out = new Headers(resp.headers);
  Object.entries({ ...baseHeaders(handlerName), ...corsHeaders(req, env) }).forEach(([k, v]) => {
    if (v) out.set(k, v);
  });
  return new Response(resp.body, { status: resp.status, headers: out });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(req, env);
    const limit = parseInt(env.RATE_LIMIT_PER_MINUTE || "60", 10) || 60;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...baseHeaders("preflight"), ...cors } });
    }

    const check = (l) => {
      const { ok, retry } = allowed(bucketKey(req), l);
      if (!ok)
        return json({ detail: "Rate limit exceeded. Try again later." }, 429, "ratelimit", req, env, {
          "Retry-After": String(retry),
        });
      return null;
    };

    // GET /health — answered at edge, probes backend with short timeout
    if (req.method === "GET" && path === "/health") {
      const denied = check(30);
      if (denied) return denied;
      let backendOK = false;
      const backend = (env.BACKEND_URL || "").replace(/\/$/, "");
      if (backend) {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 2000);
          const r = await fetch(backend + "/health", { signal: ctl.signal });
          backendOK = r.ok;
          clearTimeout(t);
        } catch {
          backendOK = false;
        }
      }
      const out = new Headers({ ...baseHeaders("health"), ...cors, "X-Served-By": "cf-worker/health" });
      out.set("Content-Type", "application/json");
      return new Response(JSON.stringify({ status: "ok", backend: backendOK, gateway: "cf-worker" }), {
        headers: out,
      });
    }

    // GET / — info
    if (req.method === "GET" && path === "/") {
      return json(
        {
          name: "Detroit LLM Gateway (CF Worker)",
          version: VERSION,
          backend: env.BACKEND_URL || null,
          endpoints: {
            chat: "POST /v1/chat/completions",
            models: "GET /v1/models",
            health: "/health",
          },
        },
        200,
        "root",
        req,
        env
      );
    }

    // Auth/Stripe — strict limit, then proxy
    if (path.startsWith("/auth/") || path.startsWith("/stripe/")) {
      const denied = check(10);
      if (denied) return denied;
      return proxy(req, env, null, path.startsWith("/auth/") ? "auth-fallback" : "stripe-fallback");
    }

    // GET /v1/models — Cache API 5 min, varied by Authorization
    if (req.method === "GET" && path === "/v1/models") {
      const denied = check(limit);
      if (denied) return denied;
      const cache = caches.default;
      const auth = req.headers.get("authorization") || "";
      const cacheKey = new Request(url.toString() + "#" + auth.slice(0, 32), { method: "GET" });
      let cached = await cache.match(cacheKey);
      if (cached) {
        const out = new Headers(cached.headers);
        Object.entries({ ...baseHeaders("models-cache"), ...cors }).forEach(([k, v]) => {
          if (v) out.set(k, v);
        });
        return new Response(cached.body, { status: cached.status, headers: out });
      }
      const resp = await proxy(req, env, null, "models-cache");
      if (resp.ok) {
        const clone = resp.clone();
        const toCache = new Response(clone.body, { status: clone.status, headers: clone.headers });
        toCache.headers.set("Cache-Control", `public, max-age=${MODELS_TTL}`);
        await cache.put(cacheKey, toCache);
      }
      return resp;
    }

    // Everything else (incl. POST /v1/*, /admin/*, /api/conversations/*) — proxy
    const denied = check(limit);
    if (denied) return denied;
    return proxy(req, env, null, "proxy-fallback");
  },
};
