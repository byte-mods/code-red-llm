# syntax=docker/dockerfile:1.7
#
# Multi-stage build for no_code_red.
#
# Stage 1 (builder): full toolchain to install deps and compile TS.
# Stage 2 (runtime): slim image, prod deps only, dist/ baked in.
#
# Base choice: node:20-bookworm-slim rather than alpine.
#   - Node-RED ships native deps (node-gyp rebuilds) and downstream sections
#     will add better-sqlite3; building those on alpine/musl is painful.
#   - bookworm-slim is ~80 MB heavier than alpine but eliminates an entire
#     class of glibc/musl runtime surprises.
#
# `claude` CLI: NOT installed by this Dockerfile. Distribution is gated by
# Anthropic; bake it into your own derived image with the install command
# appropriate to your account. The plugin boots fine without it — only the
# /generate route (S2+) fails at request time when the binary is absent.

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Tools needed only for native rebuilds during install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

# Install with full dev deps so tsc/copy-assets are available.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Build.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Trim to production deps in a separate node_modules tree we will copy to
# the runtime stage. Doing this on the builder lets us reuse the same node
# version and avoids a second `npm ci` in the runtime image.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime

# `tini` reaps zombies; curl powers the HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root user — defense in depth. Node-RED itself does not require root.
RUN groupadd --system --gid 1001 nodered \
 && useradd  --system --uid 1001 --gid nodered --create-home --home-dir /home/nodered nodered

WORKDIR /app

# Application surface — node_modules, compiled JS, copied HTML, launcher, manifest.
COPY --from=builder --chown=nodered:nodered /app/node_modules ./node_modules
COPY --from=builder --chown=nodered:nodered /app/dist ./dist
COPY --from=builder --chown=nodered:nodered /app/package.json ./package.json
COPY --from=builder --chown=nodered:nodered /app/scripts/start.mjs ./scripts/start.mjs

# /data is the persisted Node-RED userDir; mount a volume here in production.
RUN mkdir -p /data && chown nodered:nodered /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=1880 \
    NRED_USER_DIR=/data

EXPOSE 1880

USER nodered

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/no-code-red/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start.mjs"]
