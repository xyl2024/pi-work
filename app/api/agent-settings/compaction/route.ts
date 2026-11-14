import { NextResponse } from "next/server";
import {
  readAgentCompaction,
  resetAgentCompaction,
  writeAgentCompaction,
  type CompactionConfig,
} from "@/lib/server/agent-settings";
import { COMPACTION_LIMITS } from "@/lib/shared/agent-settings-types";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/agent-settings/compaction");

type ValidationResult = { ok: true; value: CompactionConfig } | { ok: false; error: string };
type TokenResult = { ok: true; value: number } | { ok: false; error: string };

function validateToken(
  value: unknown,
  field: "reserveTokens" | "keepRecentTokens",
): TokenResult {
  const range = COMPACTION_LIMITS[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < range.min || value > range.max) {
    return {
      ok: false,
      error: `compaction.${field} must be an integer between ${range.min} and ${range.max}`,
    };
  }
  return { ok: true, value };
}

function validateCompaction(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a compaction config object" };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.enabled !== "boolean") {
    return { ok: false, error: "compaction.enabled must be a boolean" };
  }

  const reserveTokens = validateToken(obj.reserveTokens, "reserveTokens");
  if (!reserveTokens.ok) return reserveTokens;

  const keepRecentTokens = validateToken(obj.keepRecentTokens, "keepRecentTokens");
  if (!keepRecentTokens.ok) return keepRecentTokens;

  return {
    ok: true,
    value: {
      enabled: obj.enabled,
      reserveTokens: reserveTokens.value,
      keepRecentTokens: keepRecentTokens.value,
    },
  };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const compaction = await readAgentCompaction();
    log.info("agent compaction read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(compaction);
  } catch (error) {
    log.error("agent compaction read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json();

    if (body && typeof body === "object" && (body as Record<string, unknown>).reset === true) {
      await resetAgentCompaction();
      log.info("agent compaction reset", { durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ success: true, reset: true });
    }

    const check = validateCompaction(body);
    if (!check.ok) {
      log.warn("agent compaction rejected", { error: check.error, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    await writeAgentCompaction(check.value);
    log.info("agent compaction written", {
      enabled: check.value.enabled,
      reserveTokens: check.value.reserveTokens,
      keepRecentTokens: check.value.keepRecentTokens,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true, value: check.value });
  } catch (error) {
    log.error("agent compaction write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
