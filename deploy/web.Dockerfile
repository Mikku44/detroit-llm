# syntax=docker/dockerfile:1.4
# ---- Stage 1: build frontend ----
FROM node:24-alpine AS frontend

WORKDIR /build/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard/ ./
RUN npm run build

# ---- Stage 2: caddy serves the static site ----
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/dashboard/dist /srv
