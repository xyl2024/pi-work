import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets test/dev instances (tests/global-setup.ts,
  // scripts/dev-isolated.mjs) build into their own directory so they can
  // never clobber the .next/ artifacts a production server is serving from
  // this same checkout. Default stays .next for normal runs.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "better-sqlite3",
    "node-pty",
    "ws",
    // CodeGraph's compiled bundle ships tree-sitter wasm loaders that neither
    // webpack nor Turbopack can compile (duplicate-symbol errors). Keep it out
    // of the bundle so it resolves via Node require at runtime instead.
    "@colbymchenry/codegraph-linux-x64",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
