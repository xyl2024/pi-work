import { NextResponse } from "next/server";
import {
  readConfig,
  writeConfig,
  type PiWorkConfig,
  FILE_VIEWER_LIMITS,
  FILE_VIEWER_KINDS,
} from "@/lib/config";
import { createLogger, elapsedMs } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/settings");

/**
 * Strict validator for the `file_viewer.max_size_mb` sub-tree. Returns
 * {ok: false, error} on the first invalid value (with the field path in
 * the message), {ok: true} if every per-kind entry is either absent
 * (parser will fall back to default) or a valid integer in [min, max].
 * Runs at the PUT boundary so the SettingsModal can't persist garbage
 * even if its own client-side validation regresses; the lib/config.ts
 * parser is independently fail-open so a hand-edited YAML never breaks
 * the file route.
 */
function validateFileViewerMaxSizeMb(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "file_viewer.max_size_mb must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const kind of FILE_VIEWER_KINDS) {
    const val = obj[kind];
    if (val === undefined) continue;
    if (
      typeof val !== "number" ||
      !Number.isFinite(val) ||
      !Number.isInteger(val) ||
      val < FILE_VIEWER_LIMITS[kind].min ||
      val > FILE_VIEWER_LIMITS[kind].max
    ) {
      const { min, max } = FILE_VIEWER_LIMITS[kind];
      return {
        ok: false,
        error: `file_viewer.max_size_mb.${kind} must be an integer between ${min} and ${max} (MB)`,
      };
    }
  }
  return { ok: true };
}

function validateFileViewer(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "file_viewer must be an object" };
  }
  return validateFileViewerMaxSizeMb(
    (raw as Record<string, unknown>).max_size_mb,
  );
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const config = readConfig();
    log.info("settings read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(config);
  } catch (error) {
    log.error("settings read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as PiWorkConfig;

    const fileViewerCheck = validateFileViewer(body.file_viewer);
    if (!fileViewerCheck.ok) {
      log.warn("settings rejected: invalid file_viewer", {
        error: fileViewerCheck.error,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json(
        { error: fileViewerCheck.error },
        { status: 400 },
      );
    }

    // If the body omitted file_viewer (or any other field) entirely,
    // merge it back from disk so we never write a partial PiWorkConfig
    // — the parser's fail-open behavior is the only thing keeping
    // missing fields from being misread, and we don't want to rely on
    // it during a write that explicitly validates.
    const onDisk = readConfig();
    const next: PiWorkConfig = body.file_viewer
      ? body
      : { ...onDisk, ...body, file_viewer: onDisk.file_viewer };

    writeConfig(next);
    log.info("settings written", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("settings write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
