/**
 * GET /api/llm-audit/calls?limit=N&offset=N&sessionId=...&status=ok|error&modelId=...&from=...&to=...
 *
 * Returns `{ rows, total }` from `provider_calls`. Rows exclude the heavy
 * bodies by default? — no: rows carry request/response bodies, the panel
 * renders truncated previews and fetches the full record via /[id] only when
 * expanded. Kept simple: list returns full rows, detail route exists for
 * expand-on-demand (avoids shipping everything twice over the wire).
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { listProviderCalls } from "@/lib/llm-audit-db";

const log = createLogger("api/llm-audit-calls");

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const sessionId = url.searchParams.get("sessionId");
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "ok" || statusParam === "error" ? statusParam : null;
    const modelId = url.searchParams.get("modelId");
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw && Number.isFinite(Number(fromRaw)) ? Number(fromRaw) : null;
    const to = toRaw && Number.isFinite(Number(toRaw)) ? Number(toRaw) : null;

    const result = listProviderCalls({ limit, offset, sessionId, status, modelId, from, to });
    log.info("llm-audit calls", {
      sessionId,
      status,
      modelId,
      limit,
      offset,
      returned: result.rows.length,
      total: result.total,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(result);
  } catch (error) {
    log.error("llm-audit calls failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
