#
# Build + run pi-work on top of the official Playwright image.
#
# The base image (mcr.microsoft.com/playwright:v1.62.1-jammy) ships:
#   - Ubuntu 22.04 (jammy)
#   - Node 24, npm 11                       (satisfies engines ">=22")
#   - chromium-1234, firefox-1538, webkit-2336 under /ms-playwright/
#   - default user: root (HOME=/root)
#   - has python3 but NOT make/g++  → we install build-essential below
#
# Both stages use the SAME base. If you ever want a slimmer production image,
# swap stage 2's FROM to `node:24-slim` and copy the build output across —
# nothing else changes. Note that node:24-slim still needs `make g++ python3`
# for better-sqlite3 to compile.

# ============================================================
# Stage 1 — build
# ============================================================
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS builder

WORKDIR /app

# better-sqlite3@11 (and any other native module) needs to compile from source
# against Node 24 — no prebuilt binaries are published for that ABI yet.
# The base image has python3 but not make/g++, so we install the C/C++ toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Layer 1: dependency manifests + public/ (changes rarely → good cache hit rate).
# public/ is needed BEFORE npm ci because the postinstall script copies
# pdfjs-dist's worker bundle into public/pdf.worker.min.mjs.
COPY package.json package-lock.json ./
COPY public/     ./public
RUN npm ci --include=dev

# Layer 2: config (almost never changes)
COPY tsconfig.json next.config.ts postcss.config.mjs tailwind.config.ts ./

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
RUN npm run build

# ============================================================
# Stage 2 — production image
# ============================================================
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Same native-build toolchain is needed here because `npm rebuild` recompiles
# better-sqlite3 against this image's Node ABI (and we explicitly skipped
# native builds in the previous `npm ci --ignore-scripts`).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=30141 \
    HOME=/root \
    NEXT_TELEMETRY_DISABLED=1

# Copy built app + manifests from the builder.
COPY --from=builder /app/.next             ./.next
COPY --from=builder /app/public            ./public
COPY --from=builder /app/package.json      ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/next.config.ts    ./

# Install production-only deps.
#   better-sqlite3 is the only required native module here. `npm ci
#   --ignore-scripts` skips postinstalls for every native dep (canvas,
#   lightningcss, ...), so they sit in node_modules uncompiled. Then we
#   rebuild ONLY better-sqlite3 against THIS image's Node ABI. canvas is
#   only needed for server-side Excalidraw PNG export, which pi-work doesn't
#   do — the client uses the browser's native canvas. lightningcss is a
#   postcss plugin used only at build time, so it's irrelevant at runtime.
RUN npm ci --omit=dev --ignore-scripts \
 && npm rebuild better-sqlite3 \
 && rm -rf /root/.npm /tmp/*

EXPOSE 30141

# Default to the production server. The image also has chromium/firefox/webkit
# under /ms-playwright/ — install @playwright/test if you want to run e2e tests.
CMD ["node_modules/.bin/next", "start", "-p", "30141"]