# syntax=docker/dockerfile:1.4

# Frontend is prebuilt on the host BEFORE docker build:
#   cd dashboard && npm install && npm run build
# No node stage here — avoids lightningcss musl + npm lock-drift issues,
# and makes docker build fast/reproducible.
# ---- Stage 1: caddy with rate-limit plugin ----
FROM caddy:2-builder AS caddy-builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY dashboard/dist /srv