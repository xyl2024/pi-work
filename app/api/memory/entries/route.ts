import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { deleteMemoryEntry, readMemoryView } from "@/lib/server/memory-store";
import type { MemoryEntriesResponse } from "@/lib/shared/memory";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/entries");

function entriesSnapshot(): MemoryEntriesResponse {
  return {
    globalEnabled: readConfig().memory.enabled === true,
    memory: readMemoryView("memory"),
    user: readMemoryView("user"),
  };
}

function validationError(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

export async function GET(_request: Request) {
  const startedAt = Date.now();
  try {
    const body = entriesSnapshot();
    log.info("memory entries read", {
      memoryStatus: body.memory.status,
      userStatus: body.user.status,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(body);
  } catch (error) {
    log.error("memory entries read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  try {
    const body = (await request.json().catch(() => undefined)) as
      | { target?: unknown; index?: unknown; hash?: unknown }
      | undefined;

    const target = body?.target;
    if (target !== "memory" && target !== "user") {
      log.warn("memory entry delete rejected", { reason: "target", durationMs: elapsedMs(startedAt) });
      return validationError("target must be memory or user");
    }
    const index = body?.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      log.warn("memory entry delete rejected", { reason: "index", target, durationMs: elapsedMs(startedAt) });
      return validationError("index must be a non-negative integer");
    }
    const hash = body?.hash;
    if (typeof hash !== "string" || hash.trim() === "") {
      log.warn("memory entry delete rejected", { reason: "hash", target, durationMs: elapsedMs(startedAt) });
      return validationError("hash is required");
    }

    const result = await deleteMemoryEntry(target, index, hash);
    if (!result.ok) {
      log.warn("memory entry delete failed", {
        target,
        code: result.code,
        index,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: result.message, code: result.code }, { status: 409 });
    }

    const snapshot = entriesSnapshot();
    log.info("memory entry deleted", {
      target,
      index,
      used: snapshot[target].used,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    log.error("memory entry delete failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
