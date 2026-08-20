import { NextResponse } from "next/server";
import {
  readAgentRetry,
  writeAgentRetry,
  resetAgentRetry,
  type AgentRetryConfig,
  type ProviderRetryConfig,
} from "@/lib/server/agent-settings";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/agent-settings/retry");

// Server-side range guards. The Settings modal's UI clamps to the same
// ranges, but we re-check on the PUT boundary so a regression in the
// modal's client-side validation (or a hand-rolled curl from a power
// user) can never push garbage into the SDK's settings.json.
const LIMITS = {
  maxRetries: { min: 0, max: 10 },
  baseDelayMs: { min: 100, max: 60_000 },
  provider: {
    timeoutMs: { min: 1_000, max: 3_600_000 },
    maxRetries: { min: 0, max: 10 },
    // 0 is legal — docs/settings.md:148 says "Set it to 0 to disable
    // the limit". So the lower bound is 0, not 1.
    maxRetryDelayMs: { min: 0, max: 300_000 },
  },
} as const;

type ValidationResult = { ok: true; value: AgentRetryConfig } | { ok: false; error: string };

function validateProvider(raw: unknown, path: string): { ok: true; value: ProviderRetryConfig } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${path} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const out: ProviderRetryConfig = {};
  for (const [field, range] of [
    ["timeoutMs", LIMITS.provider.timeoutMs],
    ["maxRetries", LIMITS.provider.maxRetries],
    ["maxRetryDelayMs", LIMITS.provider.maxRetryDelayMs],
  ] as const) {
    const v = obj[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < range.min || v > range.max) {
      return { ok: false, error: `${path}.${field} must be an integer between ${range.min} and ${range.max}` };
    }
    out[field] = v;
  }
  return { ok: true, value: out };
}

function validateRetry(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a retry config object" };
  }
  const obj = raw as Record<string, unknown>;

  // enabled
  if (typeof obj.enabled !== "boolean") {
    return { ok: false, error: "retry.enabled must be a boolean" };
  }

  // maxRetries
  if (typeof obj.maxRetries !== "number" || !Number.isFinite(obj.maxRetries) || !Number.isInteger(obj.maxRetries)) {
    return { ok: false, error: "retry.maxRetries must be an integer" };
  }
  if (obj.maxRetries < LIMITS.maxRetries.min || obj.maxRetries > LIMITS.maxRetries.max) {
    return { ok: false, error: `retry.maxRetries must be between ${LIMITS.maxRetries.min} and ${LIMITS.maxRetries.max}` };
  }

  // baseDelayMs
  if (typeof obj.baseDelayMs !== "number" || !Number.isFinite(obj.baseDelayMs) || !Number.isInteger(obj.baseDelayMs)) {
    return { ok: false, error: "retry.baseDelayMs must be an integer" };
  }
  if (obj.baseDelayMs < LIMITS.baseDelayMs.min || obj.baseDelayMs > LIMITS.baseDelayMs.max) {
    return { ok: false, error: `retry.baseDelayMs must be between ${LIMITS.baseDelayMs.min} and ${LIMITS.baseDelayMs.max} ms` };
  }

  // provider
  const providerCheck = validateProvider(obj.provider, "retry.provider");
  if (!providerCheck.ok) return providerCheck;

  return {
    ok: true,
    value: {
      enabled: obj.enabled,
      maxRetries: obj.maxRetries,
      baseDelayMs: obj.baseDelayMs,
      provider: providerCheck.value,
    },
  };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const retry = await readAgentRetry();
    log.info("agent retry read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(retry);
  } catch (error) {
    log.error("agent retry read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json();

    // Special case: {"reset": true} drops the retry key from
    // settings.json entirely. The Settings modal's "Reset to defaults"
    // button sends this.
    if (body && typeof body === "object" && (body as Record<string, unknown>).reset === true) {
      await resetAgentRetry();
      log.info("agent retry reset", { durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ success: true, reset: true });
    }

    const check = validateRetry(body);
    if (!check.ok) {
      log.warn("agent retry rejected", {
        error: check.error,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    await writeAgentRetry(check.value);
    log.info("agent retry written", {
      enabled: check.value.enabled,
      maxRetries: check.value.maxRetries,
      baseDelayMs: check.value.baseDelayMs,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true, value: check.value });
  } catch (error) {
    log.error("agent retry write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}