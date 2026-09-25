// CF Worker edge gateway (Hono) — free tier, no Containers / DOs.
//
// Two paths:
//   1. DIRECT (POC): POST /v1/chat/completions with model deepseek-* and a
//      valid dashboard session JWT -> verify JWT (stateless) + quota check
//      via Neon + stream straight from DeepSeek + usage log via waitUntil.
//   2. PROXY (everything else, incl. sk-dt-* API keys): passthrough to
//      BACKEND_URL (VPS), which remains the source of truth for auth/tiers.
//
// Quota logic mirrors backend/proxy/router.py require_access + _free_model_gate.
// Known POC simplifications (documented, not silent):
//   - no live YouTube-membership recheck (DB flags only)
//   - token fallback estimates use chars/4, backend uses tiktoken cl100k
//   - usage is logged only if the user has an active api_keys row
//     (usage_logs.api_key_id is NOT NULL)

import { Hono } from "hono";
import { cors } from "hono/cors";
import { neon } from "@neondatabase/serverless";

const VERSION = "0.3.0-hono-direct";
const MODELS_TTL = 300;
const BODY_LIMIT = 1 << 20;

// Mirrors backend/config.py TIER_OPTIONS weekly/monthly token budgets.
const TIER_BUDGETS = {
  free: [100000, 435000],
  nomad: [500000, 2170000],
  nomad_extra_claude: [90000, 360000],
  dreamer: [1000000, 4350000],
  dreamer_extra_claude: [32000, 128000],
  entrepreneur: [3000000, 13040000],
  angel: [10000000, 43450000],
};
const FREE_MODEL_ONLY_MESSAGE =
  "Free tier only includes the flash, glm-4.5-air/glm-4.7-flashx and gpt-5-nano models. Upgrade to a paid membership for pro and other models.";
const VISION_ONLY_MESSAGE =
  "deepseek-v4-flash-vision-exp is only available to paid members. Upgrade to a paid membership for vision access.";

// ---------- direct providers (POC) ----------
// Each entry mirrors one backend _proxy_to_* branch. Shared quota/usage code
// below stays provider-agnostic; only match/transform/gate differ.
function openaiCompatBody(body) {
  // Mirrors backend _openai_body: normalize for native GPT-5 models.
  const b = { ...body };
  if ("max_tokens" in b && !("max_completion_tokens" in b)) {
    b.max_completion_tokens = b.max_tokens;
    delete b.max_tokens;
  }
  delete b.temperature;
  delete b.top_p;
  delete b.logprobs;
  const reasoning = b.reasoning;
  delete b.reasoning;
  if (reasoning && typeof reasoning === "object" && !("reasoning_effort" in b)) {
    const effort = reasoning.effort;
    if (["minimal", "low", "medium", "high"].includes(effort)) b.reasoning_effort = effort;
  }
  if (b.reasoning_effort === "none") b.reasoning_effort = "minimal";
  return b;
}

function deepseekGate(modelLower, isFree) {
  // Mirrors _free_model_gate for the deepseek family.
  if (modelLower === "deepseek-v4-flash-vision-exp" && isFree) return VISION_ONLY_MESSAGE;
  if (isFree && !modelLower.includes("flash")) return FREE_MODEL_ONLY_MESSAGE;
  return null;
}

const DIRECT_PROVIDERS = [
  {
    id: "deepseek",
    match: (m) => m.startsWith("deepseek-"),
    upstreamModel: (m) => m, // backend forwards the gateway id as-is
    url: (env) => (env.DEEPSEEK_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    key: (env) => env.DEEPSEEK_API_KEY || "",
    transform: (b) => ({ ...b }),
    gate: deepseekGate,
  },
  {
    id: "openai",
    match: (m) => m === "gpt-5-nano" || m === "openai/gpt-5-nano",
    upstreamModel: () => "gpt-5-nano", // GPT_NANO_UPSTREAM_ID
    url: (env) => (env.OPENAI_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    key: (env) => env.OPENAI_API_KEY || "",
    transform: openaiCompatBody,
    gate: null, // all tiers incl. free (FREE_TIER_EXTRA_MODELS)
  },
];

// ---------- rate limit (per-isolate buckets, best-effort at edge) ----------
const buckets = new Map();
function allowed(key, limit) {
  const now = Date.now();
  let arr = buckets.get(key);
  if (!arr) {
    arr = [];
    buckets.set(key, arr);
  }
  while (arr.length && now - arr[0] > 60_000) arr.shift();
  if (arr.length >= limit) return { ok: false, retry: Math.ceil((arr[0] + 60_000 - now) / 1000) };
  arr.push(now);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return { ok: true };
}
function bucketKey(c) {
  const h = c.req.header("authorization") || "";
  if (h.startsWith("Bearer ")) return "tok:" + h.slice(7, 47);
  const k = c.req.header("x-api-key");
  if (k) return "tok:" + k.slice(0, 40);
  return "ip:" + (c.req.header("CF-Connecting-IP") || "unknown");
}
const limitTo = (n) => async (c, next) => {
  const { ok, retry } = allowed(bucketKey(c), n);
  if (!ok) {
    return c.json({ detail: "Rate limit exceeded. Try again later." }, 429, { "Retry-After": String(retry) });
  }
  await next();
};

// ---------- helpers ----------
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifySessionJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !secret) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function pgURL(url) {
  // backend secrets may carry the SQLAlchemy scheme
  return (url || "").replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
}

function estimateTokensFromMessages(messages) {
  // chars/4 approximation (backend uses tiktoken cl100k_base — see POC notes)
  let chars = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    chars += 4 + String(m?.role || "").length;
    const ct = m?.content;
    if (typeof ct === "string") chars += ct.length;
    else if (Array.isArray(ct))
      for (const p of ct) {
        if (p?.type === "text" && p?.text) chars += p.text.length;
        else if (p?.type === "image_url") chars += 340;
      }
    chars += 2;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

function parseUsageFromSSE(text) {
  // text: one or more "data: {...}" lines. Returns last usage object or null.
  let usage = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data: ") || t === "data: [DONE]") continue;
    try {
      const data = JSON.parse(t.slice(6));
      if (data && typeof data === "object" && data.usage) usage = data.usage;
    } catch {
      /* partial line across chunk boundary — ignored, next chunk carries it */
    }
  }
  return usage;
}

function textFromSSE(text) {
  let out = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data: ") || t === "data: [DONE]") continue;
    try {
      const data = JSON.parse(t.slice(6));
      const delta = data?.choices?.[0]?.delta;
      if (typeof delta?.content === "string") out += delta.content;
      if (typeof delta?.reasoning_content === "string") out += delta.reasoning_content;
    } catch {
      /* ignore */
    }
  }
  return out;
}

function sseErrorChunk(model, msg) {
  const payload = {
    choices: [{ index: 0, delta: { role: "assistant", content: msg }, finish_reason: "stop" }],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;
}

async function proxyTo(c, handler) {
  const backend = (c.env.BACKEND_URL || "").replace(/\/$/, "");
  if (!backend) return c.json({ detail: "BACKEND_URL not configured" }, 500);
  const url = new URL(c.req.url);
  const target = backend + url.pathname + url.search;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  let resp;
  try {
    resp = await fetch(target, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
      redirect: "manual",
    });
  } catch {
    return c.json({ detail: "backend unavailable, fallback" }, 502);
  }
  const out = new Headers(resp.headers);
  out.set("X-Gateway", "cf-worker");
  out.set("X-Gateway-Version", VERSION);
  out.set("X-Via", "cf-worker");
  out.set("X-Handler", handler);
  return new Response(resp.body, { status: resp.status, headers: out });
}

// ---------- app ----------
const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Gateway", "cf-worker");
  c.header("X-Gateway-Version", VERSION);
  c.header("X-Via", "cf-worker");
});

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const dash = c.env.DASHBOARD_URL || "";
      if (origin === "http://localhost:5173" || origin === "http://localhost:5174") return origin;
      if (dash && origin === dash) return origin;
      return dash || null;
    },
    allowHeaders: ["*"],
    allowMethods: ["*"],
    credentials: true,
    exposeHeaders: ["X-Gateway", "X-Handler", "X-Served-By", "X-Response-Time", "X-Gateway-Version"],
  })
);

const rateLimit = () => async (c, next) => {
  const limit = parseInt(c.env.RATE_LIMIT_PER_MINUTE || "60", 10) || 60;
  return limitTo(limit)(c, next);
};

app.get("/health", limitTo(30), async (c) => {
  let backendOK = false;
  const backend = (c.env.BACKEND_URL || "").replace(/\/$/, "");
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
  c.header("X-Served-By", "cf-worker/health");
  c.header("X-Handler", "health");
  return c.json({ status: "ok", backend: backendOK, gateway: "cf-worker" });
});

app.get("/", async (c) => {
  c.header("X-Handler", "root");
  return c.json({
    name: "Detroit LLM Gateway (CF Worker)",
    version: VERSION,
    backend: c.env.BACKEND_URL || null,
    direct: ["deepseek-*", "gpt-5-nano (session JWT only, POC)"],
    endpoints: { chat: "POST /v1/chat/completions", models: "GET /v1/models", health: "/health" },
  });
});

app.all("/auth/*", limitTo(10), (c) => proxyTo(c, "auth-fallback"));
app.all("/stripe/*", limitTo(10), (c) => proxyTo(c, "stripe-fallback"));

app.get("/v1/models", rateLimit(), async (c) => {
  const cache = caches.default;
  const auth = c.req.header("authorization") || "";
  const cacheKey = new Request(c.req.url + "#" + auth.slice(0, 32), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const out = new Headers(cached.headers);
    out.set("X-Handler", "models-cache");
    return new Response(cached.body, { status: cached.status, headers: out });
  }
  const resp = await proxyTo(c, "models-cache");
  if (resp.ok) {
    const toCache = new Response(resp.clone().body, { status: resp.status, headers: resp.headers });
    toCache.headers.set("Cache-Control", `public, max-age=${MODELS_TTL}`);
    await cache.put(cacheKey, toCache);
  }
  return resp;
});

// ---------- DIRECT: deepseek via session JWT ----------
app.post("/v1/chat/completions", rateLimit(), async (c) => {
  let body;
  try {
    const len = parseInt(c.req.header("content-length") || "0", 10);
    if (len > BODY_LIMIT) return c.json({ detail: "Request body too large" }, 413);
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }
  const model = String(body?.model || "");
  const modelLower = model.toLowerCase();
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  const provider = DIRECT_PROVIDERS.find((p) => p.match(modelLower));
  const providerKey = provider ? provider.key(c.env) : "";
  if (!provider || !providerKey || !token.includes(".")) {
    // sk-dt-* API keys, non-direct models, or no key configured -> VPS (source of truth)
    return proxyRaw(c, body, "proxy-fallback");
  }
  const userId = await verifySessionJWT(token, c.env.JWT_SECRET || "");
  if (!userId) return proxyRaw(c, body, "proxy-fallback");

  // --- quota check via Neon (mirrors backend require_access + _free_model_gate)
  let user = null;
  let dailyUsed = 0;
  let weeklyUsed = 0;
  let monthlyUsed = 0;
  let apiKeyId = null;
  try {
    const sql = neon(pgURL(c.env.DATABASE_URL));
    const rows = await sql`
      SELECT (SELECT row_to_json(u) FROM (SELECT id, is_owner, is_member, is_paid, tier_id FROM users WHERE id = ${userId}) u) AS user,
             (SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs ul JOIN api_keys ak ON ak.id = ul.api_key_id
               WHERE ak.user_id = ${userId} AND ul.created_at >= NOW() - INTERVAL '1 day') AS daily,
             (SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs ul JOIN api_keys ak ON ak.id = ul.api_key_id
               WHERE ak.user_id = ${userId} AND ul.created_at >= NOW() - INTERVAL '7 days') AS weekly,
             (SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs ul JOIN api_keys ak ON ak.id = ul.api_key_id
               WHERE ak.user_id = ${userId} AND ul.created_at >= NOW() - INTERVAL '30 days') AS monthly,
             (SELECT id FROM api_keys WHERE user_id = ${userId} AND is_active ORDER BY created_at LIMIT 1) AS api_key_id
    `;
    const r = rows?.[0] || {};
    user = r.user || null;
    dailyUsed = Number(r.daily || 0);
    weeklyUsed = Number(r.weekly || 0);
    monthlyUsed = Number(r.monthly || 0);
    apiKeyId = r.api_key_id || null;
  } catch (e) {
    // DB unreachable -> do NOT fail open on quota; fall back to VPS.
    return proxyRaw(c, body, "proxy-fallback");
  }

  // Mirrors require_access order: tier subscription first (even for
  // owners/members), then member/owner/paid bypass, then free budgets.
  // Missing user -> 403 like backend ("Membership required").
  if (!user) {
    return c.json({ detail: "Membership required" }, 403);
  }
  const isFree = !user.is_owner && !user.is_member && !user.is_paid;
  if (provider.gate) {
    const denied = provider.gate(modelLower, isFree);
    if (denied) return c.json({ detail: denied }, 403);
  }
  const tierId = user.tier_id || "";
  if (tierId && tierId !== "free" && TIER_BUDGETS[tierId]) {
    const [weekly, monthly] = TIER_BUDGETS[tierId];
    const daily = Math.floor((weekly + 6) / 7);
    if (weeklyUsed >= weekly) {
      return c.json({ detail: "Weekly limit reached. Upgrade to a higher tier or wait for the weekly window to reset." }, 403);
    }
    if (dailyUsed >= daily) {
      return c.json({ detail: "Daily limit reached. Upgrade to a higher tier or wait for the daily window to reset." }, 403);
    }
    if (monthlyUsed >= monthly) {
      return c.json({ detail: "Monthly limit reached. Upgrade to a higher tier or wait until next month." }, 403);
    }
  } else if (!user.is_member && !user.is_owner && !user.is_paid) {
    const [weekly, monthly] = TIER_BUDGETS.free;
    const daily = Math.floor((weekly + 6) / 7);
    if (weeklyUsed >= weekly) {
      return c.json({ detail: "Weekly limit reached. Upgrade to a paid membership for more usage." }, 403);
    }
    if (dailyUsed >= daily) {
      return c.json({ detail: "Daily limit reached. Upgrade to a paid membership for more usage." }, 403);
    }
    if (monthlyUsed >= monthly) {
      return c.json({ detail: "Monthly limit reached. Upgrade to a paid membership for more usage." }, 403);
    }
  }

  // --- upstream
  const stream = body.stream === true;
  const upstreamBody = provider.transform({ ...body, model: provider.upstreamModel(model) });
  const upstreamModel = provider.upstreamModel(model);
  if (stream) {
    upstreamBody.stream_options = { ...(upstreamBody.stream_options || {}), include_usage: true };
  }
  const providerURL = provider.url(c.env);
  let upstream;
  try {
    upstream = await fetch(providerURL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerKey}` },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    return c.json({ detail: "upstream unavailable" }, 502);
  }

  const logUsage = async (promptTokens, completionTokens, textFallback) => {
    try {
      let pt = promptTokens || 0;
      let ct = completionTokens || 0;
      if (!pt) pt = estimateTokensFromMessages(body.messages);
      if (!ct && textFallback) ct = Math.max(1, Math.ceil(textFallback.length / 4));
      if (!apiKeyId) return; // usage_logs.api_key_id is NOT NULL — skip when user has no API key (POC gap)
      const sql = neon(pgURL(c.env.DATABASE_URL));
      await sql`INSERT INTO usage_logs (id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)
                VALUES (gen_random_uuid(), ${apiKeyId}, ${upstreamModel}, ${pt}, ${ct}, ${pt + ct}, NOW())`;
    } catch {
      /* logging must never break the response */
    }
  };

  if (stream) {
    if (upstream.status >= 400) {
      const errText = await upstream.text().catch(() => "");
      let msg = `Upstream error ${upstream.status}`;
      try {
        msg = JSON.parse(errText)?.error?.message || msg;
      } catch {
        /* keep default */
      }
      c.header("X-Handler", provider.id + "-direct");
      c.header("Content-Type", "text/event-stream");
      return c.body(sseErrorChunk(upstreamModel, `⚠️ ${upstreamModel}: ${msg} — Please try again later.`), 200);
    }
    let buf = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let text = "";
    const transform = new TransformStream({
      transform(chunk, controller) {
        const s = new TextDecoder().decode(chunk, { stream: true });
        buf += s;
        // parse complete lines only; keep trailing partial in buf
        const idx = buf.lastIndexOf("\n");
        if (idx !== -1) {
          const complete = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          const u = parseUsageFromSSE(complete);
          if (u) {
            promptTokens = u.prompt_tokens ?? promptTokens;
            completionTokens = u.completion_tokens ?? completionTokens;
          }
          text += textFromSSE(complete);
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (buf) {
          const u = parseUsageFromSSE(buf);
          if (u) {
            promptTokens = u.prompt_tokens ?? promptTokens;
            completionTokens = u.completion_tokens ?? completionTokens;
          }
          text += textFromSSE(buf);
        }
        c.executionCtx.waitUntil(logUsage(promptTokens, completionTokens, text));
      },
    });
    c.header("X-Handler", provider.id + "-direct");
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    return c.body(upstream.body.pipeThrough(transform), 200);
  }

  const data = await upstream.json().catch(() => null);
  if (!data || upstream.status >= 400) {
    c.header("X-Handler", provider.id + "-direct");
    return c.json(data || { detail: `Upstream error ${upstream.status}` }, upstream.status >= 400 ? upstream.status : 502);
  }
  const usage = data.usage || {};
  c.executionCtx.waitUntil(
    logUsage(usage.prompt_tokens || 0, usage.completion_tokens || 0, JSON.stringify(data.choices || []))
  );
  c.header("X-Handler", provider.id + "-direct");
  return c.json(data, upstream.status);
});

// proxy with already-parsed body (avoids re-reading the consumed stream)
async function proxyRaw(c, body, handler) {
  const backend = (c.env.BACKEND_URL || "").replace(/\/$/, "");
  if (!backend) return c.json({ detail: "BACKEND_URL not configured" }, 500);
  const url = new URL(c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.set("content-type", "application/json");
  headers.set("content-length", String(new TextEncoder().encode(JSON.stringify(body)).length));
  let resp;
  try {
    resp = await fetch(backend + url.pathname + url.search, {
      method: c.req.method,
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch {
    return c.json({ detail: "backend unavailable, fallback" }, 502);
  }
  const out = new Headers(resp.headers);
  out.set("X-Gateway", "cf-worker");
  out.set("X-Gateway-Version", VERSION);
  out.set("X-Via", "cf-worker");
  out.set("X-Handler", handler);
  return new Response(resp.body, { status: resp.status, headers: out });
}

// ---------- fallback: everything else to VPS ----------
app.all("/*", rateLimit(), (c) => proxyTo(c, "proxy-fallback"));

export default app;
