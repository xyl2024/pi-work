import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch {}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "better-sqlite3",
    "node-pty",
    "ws",
    "undici",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
