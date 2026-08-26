import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { dataPath } from "@/lib/server/data-dir";

const log = createLogger("api/default-cwd");

declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

// POST /api/default-cwd
// Creates <data root>/workspace/pi-cwd-default if it doesn't exist and returns the path.
export async function POST() {
  const startedAt = Date.now();
  try {
    const dir = dataPath("workspace", "pi-cwd-default");
    mkdirSync(dir, { recursive: true });
    globalThis.__piAllowedRootsCache?.roots.add(dir);
    log.info("default cwd created", { cwd: dir, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    log.error("default cwd create failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
