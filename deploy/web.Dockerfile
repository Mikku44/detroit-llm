# syntax=docker/dockerfile:1.4

# ---- Stage 1: build frontend ----
FROM node:24-alpine AS frontend

WORKDIR /build/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./

# ให้ Node prefer IPv4 + เพิ่ม retry/timeouts
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 10000 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && npm config set registry https://registry.npmjs.org/ \
    && npm ci --loglevel=info

COPY dashboard/ ./
RUN npm run build

# ---- Stage 2: caddy with rate-limit plugin ----
FROM caddy:2-builder AS caddy-builder

RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/dashboard/dist /srv