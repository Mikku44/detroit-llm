# syntax=docker/dockerfile:1.4

# ---- Stage 1: build frontend ----
# NOTE: debian-slim (glibc), not alpine (musl). lightningcss/tailwind v4's
# optional musl binary (lightningcss.linux-x64-musl.node) is flaky on alpine
# and fails with MODULE_NOT_FOUND. glibc build stage is reliable; final
# stage is still alpine, size is unaffected (only dist/ is copied).
FROM node:24-bookworm-slim AS frontend

WORKDIR /build/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --loglevel=info

COPY dashboard/ ./
RUN npm run build

# ---- Stage 2: caddy with rate-limit plugin ----
FROM caddy:2-builder AS caddy-builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/dashboard/dist /srv