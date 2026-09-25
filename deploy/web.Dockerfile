# syntax=docker/dockerfile:1.4

# Build the Vite frontend inside Docker. Use Debian rather than Alpine here so
# native npm dependencies (for example lightningcss) use their glibc builds.
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app

# Keep dependency installation cached until the manifests change.
COPY dashboard/package.json dashboard/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY dashboard/ ./
RUN npm run build

# Build Caddy with the rate-limit plugin.
FROM caddy:2-builder AS caddy-builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder /app/dist /srv
