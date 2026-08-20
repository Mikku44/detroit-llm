# Security Fixes TODO

## Critical

- [ ] **1. Remove `gateway.db` from git** — contains user emails, YouTube channel IDs, and plaintext `api_keys.raw_key`. Run `git rm --cached gateway.db`, add to `.gitignore`, then rotate all issued API keys.

- [ ] **2. Stop storing/returning API keys in plaintext** — `db/models.py:39` stores `raw_key`; `admin/router.py:59` returns it on every `GET /admin/keys`. Drop the `raw_key` column, keep only `key_hash`/`key_prefix`, and return the raw key once from the `POST /admin/keys` response.

- [ ] **3. Stop passing JWT in URL query** — `auth/youtube.py:280` redirects to `/callback?token=...` (leaks via history/logs/Referer). Return token in URL fragment or an `httpOnly` cookie.

- [ ] **4. Require a real JWT secret** — `config.py:25` defaults to `"change-me-to-a-random-secret"`. Fail fast at startup if `JWT_SECRET` is missing or still the default.

## High

- [ ] **5. Purge `__pycache__/*.pyc` from git** — compiled `config.pyc` etc. may embed secrets. Add `__pycache__/` and `*.pyc` to `.gitignore`; remove from history.

- [ ] **6. Encrypt/persist owner refresh token safely** — `auth/youtube.py:27-53` writes `OWNER_REFRESH_TOKEN` to `.env` in plaintext.

## Medium

- [ ] **7. Rate-limit auth/admin routes** — `main.py:43` only throttles `/v1/`. Add limiting for `/auth/youtube/*`, `/admin/keys`, `/admin/users`.

- [ ] **8. Redact sensitive data in logs** — `_print_request_log` / `_with_log` (`proxy/router.py:687-731`) print full prompts and responses to terminal.

- [ ] **9. Replace unmaintained deps** — remove unused `passlib[bcrypt]`; replace `python-jose 3.3.0` (JWT) with `PyJWT`.

- [ ] **10. Stop leaking `members_url`** in `/health` — `main.py:79`.

## Low / Notes

- [ ] **11. Tighten CORS** — `main.py:32-38` uses `allow_credentials=True` with wildcard methods/headers.
- [ ] **12. Distributed rate limiter** — current limiter is in-memory (single-worker only).
- [ ] **13. Enforce HTTPS / TrustedHost** in production.
- [ ] **14. Validate JWT `aud`/`iss`** in `auth/session.py:25`.
