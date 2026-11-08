import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { isMemoryEnabledForCwd } from "@/lib/server/memory-cwd-store";
import {
  addMemoryEntry,
  deleteMemoryEntry,
  readMemoryView,
  updateMemoryEntry,
} from "@/lib/server/memory-store";
import type { MemoryEntriesResponse, MemoryTarget } from "@/lib/shared/memory";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/entries");

function cwdOf(request: Request): string | null {
  const cwd = new URL(request.url).searchParams.get("cwd")?.trim() ?? "";
  return cwd === "" ? null : cwd;
}

function enabledFor(cwd: string | null): boolean {
  const globalEnabled = readConfig().memory.enabled === true;
  return cwd === null ? globalEnabled : isMemoryEnabledForCwd(cwd, globalEnabled);
}

function entriesSnapshot(enabled: boolean): MemoryEntriesResponse {
  return {
    enabled,
    memory: readMemoryView("memory"),
    user: readMemoryView("user"),
  };
}

function validationError(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

interface WriteBody {
  target?: unknown;
  content?: unknown;
  index?: unknown;
  hash?: unknown;
}

function targetOf(body: WriteBody | undefined): MemoryTarget | null {
  return body?.target === "memory" || body?.target === "user" ? body.target : null;
}

function contentOf(body: WriteBody | undefined): string | null {
  return typeof body?.content === "string" ? body.content : null;
}

function firstValidationError(body: WriteBody | undefined): string | null {
  if (targetOf(body) === null) return "target must be memory or user";
  if (contentOf(body) === null) return "content must be a string";
  return null;
}

function pinnedValidationError(body: WriteBody | undefined): string | null {
  const base = firstValidationError(body);
  if (base !== null) return base;
  const index = body?.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return "index must be a non-negative integer";
  }
  const hash = body?.hash;
  if (typeof hash !== "string" || hash.trim() === "") return "hash is required";
  return null;
}

function writeFailure(
  result: { ok: false; code: string; message: string },
  target: MemoryTarget,
  startedAt: number,
  action: string,
): NextResponse {
  log.warn(`memory entry ${action} failed`, {
    target,
    code: result.code,
    durationMs: elapsedMs(startedAt),
  });
  return NextResponse.json({ error: result.message, code: result.code }, { status: 409 });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const body = entriesSnapshot(enabledFor(cwdOf(request)));
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = (await request.json().catch(() => undefined)) as WriteBody | undefined;
    const error = firstValidationError(body);
    if (error !== null) {
      log.warn("memory entry add rejected", { reason: error, durationMs: elapsedMs(startedAt) });
      return validationError(error);
    }
    const target = targetOf(body)!;
    const content = contentOf(body)!;

    const result = await addMemoryEntry(target, content);
    if (!result.ok) return writeFailure(result, target, startedAt, "add");

    const snapshot = entriesSnapshot(enabledFor(cwdOf(request)));
    log.info("memory entry added", {
      target,
      used: snapshot[target].used,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    log.error("memory entry add failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  try {
    const body = (await request.json().catch(() => undefined)) as WriteBody | undefined;
    const error = pinnedValidationError(body);
    if (error !== null) {
      log.warn("memory entry update rejected", { reason: error, durationMs: elapsedMs(startedAt) });
      return validationError(error);
    }
    const target = targetOf(body)!;
    const content = contentOf(body)!;
    const index = body!.index as number;
    const hash = body!.hash as string;

    const result = await updateMemoryEntry(target, index, hash, content);
    if (!result.ok) return writeFailure(result, target, startedAt, "update");

    const snapshot = entriesSnapshot(enabledFor(cwdOf(request)));
    log.info("memory entry updated", {
      target,
      index,
      used: snapshot[target].used,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    log.error("memory entry update failed", { error, durationMs: elapsedMs(startedAt) });
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

    const enabled = enabledFor(cwdOf(request));
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

    const snapshot = entriesSnapshot(enabled);
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
