#
# Build + run pi-work on a minimal Debian base. Override the base if needed:
#   docker build --build-arg BASE_IMAGE=xxx .
# Any base must provide Node >= 22 + corepack, and python3/make/g++ for the
# better-sqlite3 and node-pty native builds.

# Must precede FROM to be usable in FROM lines.
ARG BASE_IMAGE=node:24-bookworm-slim

# ============================================================
# Stage 1 — build
# ============================================================
FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Native modules (better-sqlite3, node-pty) compile from source: slim images
# ship neither python3 nor the C++ toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# pnpm version comes from package.json "packageManager" (fetched on first use).
# COREPACK_HOME is only overridden for base images that keep the corepack cache
# outside the default /root/.cache/node/corepack (docker-base-images/ pins it to
# /usr/local/corepack). Not exported as ENV, so the image's own HOME stays in charge.
ARG COREPACK_HOME=/root/.cache/node/corepack
RUN corepack enable

# public/ and scripts/ must exist before install: the root postinstall
# (scripts/copy-pdf-worker.mjs) writes public/pdf.worker.min.mjs. pnpm-workspace.yaml
# carries the pnpm settings needed for an identical resolution.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY public/     ./public
COPY scripts/    ./scripts
# The published pnpm tarball ships node-gyp's gyp_main.py as 0644; make then
# fails with "Permission denied" whenever it regenerates the build Makefile.
RUN corepack pnpm --version >/dev/null \
 && for d in /root/.cache/node/corepack "${COREPACK_HOME}"; do \
      if [ -d "$d" ]; then find "$d" -path '*node-gyp/gyp/gyp_main.py' -exec chmod +x {} +; fi; \
    done \
 && pnpm install --frozen-lockfile

# proxy.ts is compiled into .next (next 16 middleware) so it must be here.
COPY tsconfig.json next.config.ts postcss.config.mjs tailwind.config.ts proxy.ts ./

# Source. extensions/ is intentionally skipped: pi loads them from disk at runtime.
COPY app/        ./app
COPY components/ ./components
COPY hooks/      ./hooks
COPY lib/        ./lib
COPY instrumentation.ts ./

RUN pnpm run build \
 && rm -rf .next/cache

# ============================================================
# Stage 2 — production dependencies
# ============================================================
# Kept separate from the runtime stage so the build toolchain (and the pnpm
# store) never lands in the final image.
FROM ${BASE_IMAGE} AS prod-deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Same override as the builder stage: pass --build-arg COREPACK_HOME=/usr/local/corepack
# when BASE_IMAGE comes from docker-base-images/.
ARG COREPACK_HOME=/root/.cache/node/corepack

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# --prod is explicit because pnpm ignores NODE_ENV here. --ignore-scripts skips
# every native postinstall, then we rebuild only the two modules needed at
# runtime: node-pty has no Linux prebuilds, better-sqlite3 must match the ABI.
RUN corepack pnpm --version >/dev/null \
 && for d in /root/.cache/node/corepack "${COREPACK_HOME}"; do \
      if [ -d "$d" ]; then find "$d" -path '*node-gyp/gyp/gyp_main.py' -exec chmod +x {} +; fi; \
    done \
 && pnpm install --prod --ignore-scripts \
 && pnpm rebuild better-sqlite3 node-pty \
 && rm -rf /root/.npm /root/.cache /root/.local /tmp/*

# ============================================================
# Stage 3 — runtime
# ============================================================
FROM ${BASE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \
    PORT=30141 \
    HOME=/root \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder   /app/.next    ./.next
COPY --from=builder   /app/public   ./public
COPY --from=builder   /app/next.config.ts  ./
COPY --from=prod-deps /app/node_modules    ./node_modules
COPY --from=prod-deps /app/package.json    ./

EXPOSE 30141

CMD ["node_modules/.bin/next", "start", "-p", "30141"]
