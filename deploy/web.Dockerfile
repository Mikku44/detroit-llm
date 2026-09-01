# syntax=docker/dockerfile:1.4
# ---- Stage 1: build frontend ----
FROM node:24-alpine AS frontend

WORKDIR /build/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm install

COPY dashboard/ ./
RUN npm run build

# ---- Stage 2: caddy with rate-limit plugin ----
FROM caddy:2-builder AS caddy-builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/dashboard/dist /srv
