import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  createMemoryFile,
  deleteMemoryFile,
  readMemoryFile,
  writeMemoryFile,
} from "@/lib/server/memory-files";
import { isAllowedMemoryFileName } from "@/lib/shared/memory-main-view";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/file");

function memoryDisabled(): NextResponse {
  return NextResponse.json({ error: "Memory is not enabled" }, { status: 404 });
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  if (readConfig().memory.enabled !== true) {
    const response = memoryDisabled();
    log.info("memory file create rejected", { status: response.status, durationMs: elapsedMs(startedAt) });
    return response;
  }
  const body = (await req.json().catch(() => undefined)) as { file?: unknown } | undefined;
  if (typeof body?.file !== "string") {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const outcome = createMemoryFile(body.file);
  if (outcome === "index" || outcome === "invalid") {
    return NextResponse.json({ error: "Invalid memory file name" }, { status: 400 });
  }
  if (outcome === "exists") {
    return NextResponse.json({ error: "Memory file already exists" }, { status: 409 });
  }
  log.info("memory file created", { file: body.file, durationMs: elapsedMs(startedAt) });
  return NextResponse.json({ created: true });
}

export async function DELETE(req: Request) {
  const startedAt = Date.now();
  if (readConfig().memory.enabled !== true) {
    const response = memoryDisabled();
    log.info("memory file delete rejected", { status: response.status, durationMs: elapsedMs(startedAt) });
    return response;
  }
  const file = new URL(req.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  const outcome = deleteMemoryFile(file);
  if (outcome === "index" || outcome === "invalid") {
    return NextResponse.json({ error: "Invalid memory file name" }, { status: 400 });
  }
  if (outcome === "missing") {
    return NextResponse.json({ error: "Memory file not found" }, { status: 404 });
  }
  log.info("memory file deleted", { file, durationMs: elapsedMs(startedAt) });
  return NextResponse.json({ deleted: true });
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  if (readConfig().memory.enabled !== true) {
    const response = memoryDisabled();
    log.info("memory file read rejected", { status: response.status, durationMs: elapsedMs(startedAt) });
    return response;
  }
  const file = new URL(req.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (!isAllowedMemoryFileName(file)) {
    return NextResponse.json({ error: "Invalid memory file name" }, { status: 400 });
  }
  try {
    const result = readMemoryFile(file);
    if (result === null) {
      return NextResponse.json({ error: "Memory file not found" }, { status: 404 });
    }
    log.info("memory file read", { file, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(result);
  } catch (error) {
    log.error("memory file read failed", { file, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  if (readConfig().memory.enabled !== true) {
    const response = memoryDisabled();
    log.info("memory file write rejected", { status: response.status, durationMs: elapsedMs(startedAt) });
    return response;
  }
  const body = (await req.json().catch(() => undefined)) as
    | { file?: unknown; content?: unknown; mtime?: unknown; force?: unknown }
    | undefined;
  if (typeof body?.file !== "string" || typeof body.content !== "string") {
    return NextResponse.json({ error: "file and content are required" }, { status: 400 });
  }
  if (!isAllowedMemoryFileName(body.file)) {
    return NextResponse.json({ error: "Invalid memory file name" }, { status: 400 });
  }
  try {
    const result = writeMemoryFile(body.file, body.content, {
      openedMtime: typeof body.mtime === "string" ? body.mtime : undefined,
      force: body.force === true,
    });
    if (result === null) {
      return NextResponse.json({ error: "Invalid memory file name" }, { status: 400 });
    }
    if (result.status === "conflict") {
      log.info("memory file write conflicted", { file: body.file, durationMs: elapsedMs(startedAt) });
      return NextResponse.json(
        { error: "Memory file changed on disk", content: result.content, mtime: result.mtime },
        { status: 409 },
      );
    }
    log.info("memory file written", { file: body.file, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(result);
  } catch (error) {
    log.error("memory file write failed", { file: body.file, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
