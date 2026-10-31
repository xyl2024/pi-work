import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  deepSeekApiKeyStatus,
  deleteDeepSeekApiKey,
  saveDeepSeekApiKey,
} from "@/lib/server/deepseek/credentials";

export const dynamic = "force-dynamic";

const log = createLogger("api/settings/deepseek-key");

export async function GET() {
  const startedAt = Date.now();
  try {
    const status = deepSeekApiKeyStatus();
    log.info("deepseek key status read", {
      configured: status.configured,
      source: status.source,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(status);
  } catch (error) {
    log.error("deepseek key status read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    saveDeepSeekApiKey(apiKey);
    log.info("deepseek key saved", { source: "file", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("deepseek key save failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  const startedAt = Date.now();
  try {
    deleteDeepSeekApiKey();
    log.info("deepseek key cleared", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("deepseek key clear failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
