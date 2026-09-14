#
# Build + run pi-work on top of the official Playwright image.
#
# The base image (mcr.microsoft.com/playwright:v1.62.1-jammy) ships:
#   - Ubuntu 22.04 (jammy)
#   - Node 24, npm 11, corepack            (satisfies engines ">=22")
#   - chromium-1234, firefox-1538, webkit-2336 under /ms-playwright/
#   - default user: root (HOME=/root)
#   - has python3 but NOT make/g++  → we install build-essential below
#
# Packages are installed with pnpm (the version is pinned in package.json via
# `packageManager`, and `corepack enable` makes that pin authoritative here).
#
# Both stages use the SAME base. If you ever want a slimmer production image,
# swap stage 2's FROM to `node:24-slim` and copy the build output across —
# nothing else changes. Note that node:24-slim still needs `make g++ python3`
# for better-sqlite3 to compile.

# ============================================================
# Stage 1 — build
# ============================================================

# FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS builder
FROM playwright-cli-devenv:extended AS builder

WORKDIR /app

# better-sqlite3@11 (and any other native module) needs to compile from source
# against Node 24 — no prebuilt binaries are published for that ABI yet.
# The base image has python3 but not make/g++, so we install the C/C++ toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# pnpm shim, pinned to the version in package.json ("packageManager").
# The download happens on the first `pnpm` call below.
RUN corepack enable

# Layer 1: dependency manifests + public/ (changes rarely → good cache hit rate).
# public/ is needed BEFORE the install because the root postinstall script
# copies pdfjs-dist's worker bundle into public/pdf.worker.min.mjs.
# pnpm-workspace.yaml carries the repo's pnpm settings (allowed build scripts,
# ignored platform packages, hoisting) and MUST be present for an identical
# resolution.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY public/     ./public
RUN pnpm install --frozen-lockfile

# Layer 2: config (almost never changes)
# proxy.ts is the Next.js 16 middleware convention (global auth gateway) — it is
# compiled into the .next output at build time, so it MUST be present here.
COPY tsconfig.json next.config.ts postcss.config.mjs tailwind.config.ts proxy.ts ./

# Build-time scripts. `pnpm run build` triggers the `prebuild` lifecycle hook
# (`node scripts/clean-stale-build-types.mjs`), so scripts/ must exist before the
# build runs — otherwise pnpm fails with MODULE_NOT_FOUND.
COPY scripts/    ./scripts

# Layer 3: source code (changes frequently → invalidates only this layer).
# extensions/ is intentionally NOT copied: pi-work builds without bundling
# extension sources; pi loads them from disk at runtime (see lib/rpc-manager).
COPY app/        ./app
COPY components/ ./components
COPY hooks/      ./hooks
COPY lib/        ./lib
COPY instrumentation.ts ./

# Build the production bundle. `next build --webpack` is the project's chosen
# build (see package.json scripts.build).
RUN pnpm run build

# ============================================================
# Stage 2 — production image
# ============================================================
# FROM mcr.microsoft.com/playwright:v1.62.1-jammy
FROM playwright-cli-devenv:extended

WORKDIR /app

# Same native-build toolchain is needed here because `pnpm rebuild` recompiles
# better-sqlite3 against this image's Node ABI (and we explicitly skipped
# native builds in the previous `pnpm install --ignore-scripts`).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# pnpm shim, same pinned version as the builder stage.
RUN corepack enable

ENV NODE_ENV=production \
    PORT=30141 \
    HOME=/root \
    NEXT_TELEMETRY_DISABLED=1

# Copy built app + manifests from the builder.
COPY --from=builder /app/.next              ./.next
COPY --from=builder /app/public             ./public
COPY --from=builder /app/package.json       ./
COPY --from=builder /app/pnpm-lock.yaml     ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/.npmrc             ./
COPY --from=builder /app/next.config.ts     ./

# Install production-only deps.
#   better-sqlite3 and node-pty are the required native modules here.
#   `--ignore-scripts` skips postinstalls for every native dep (canvas,
#   lightningcss, ...), so they sit in node_modules uncompiled. Then we rebuild
#   ONLY better-sqlite3 and node-pty against THIS image's Node ABI. lightningcss
#   is a postcss plugin used only at build time, so it's irrelevant at runtime.
#
#   `--prod` is explicit on purpose: pnpm ignores NODE_ENV when deciding whether
#   devDependencies are installed, and `--frozen-lockfile` is not needed here
#   because `pnpm install --prod` reuses the committed lockfile as-is (it does
#   not recompute an "ideal tree" the way npm's `ci --omit=dev` did, so the
#   false EUSAGE "lockfile out of sync" failure npm had cannot happen).
#
#   node-pty ships prebuilt binaries for darwin/win32 only — on Linux we
#   MUST compile from source against the running Node ABI, otherwise
#   `instrumentation.ts` → `lib/server/terminal/startup` will fail to
#   load `./prebuilds/linux-x64/pty.node` at server boot.
#
#   `pnpm store prune` drops unreferenced store entries (the store itself is
#   not needed once node_modules is materialised — entries are hardlinked).
RUN pnpm install --prod --ignore-scripts \
 && pnpm rebuild better-sqlite3 node-pty \
 && pnpm store prune \
 && rm -rf /root/.npm /tmp/*

EXPOSE 30141

# Default to the production server. The image also has chromium/firefox/webkit
# under /ms-playwright/ — install @playwright/test if you want to run e2e tests.
CMD ["node_modules/.bin/next", "start", "-p", "30141"]
