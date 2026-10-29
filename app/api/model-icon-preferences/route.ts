import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { readModelIconPreferences, setModelIconPreference } from "@/lib/server/model-icon-preferences";
import { MODEL_ICON_PREFERENCE_PROVIDER } from "@/lib/shared/model-icon-match";

export const dynamic = "force-dynamic";

const log = createLogger("api/model-icon-preferences");

// GET /api/model-icon-preferences → { preferences: { "provider:modelId": "provider" } }
export async function GET() {
  const startedAt = Date.now();
  try {
    const preferences = readModelIconPreferences();
    log.info("model icon preferences read", { count: Object.keys(preferences).length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ preferences });
  } catch (error) {
    log.error("model icon preferences read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/model-icon-preferences { provider, modelId, preference } → { preferences }
export async function PUT(req: Request) {
  const startedAt = Date.now();
  let body: { provider?: unknown; modelId?: unknown; preference?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const preference = body?.preference;
  if (!provider || !modelId) {
    return NextResponse.json({ error: "provider and modelId must be non-empty strings" }, { status: 400 });
  }
  if (preference !== MODEL_ICON_PREFERENCE_PROVIDER && preference !== "auto") {
    return NextResponse.json({ error: `preference must be "${MODEL_ICON_PREFERENCE_PROVIDER}" or "auto"` }, { status: 400 });
  }
  try {
    const preferences = setModelIconPreference(provider, modelId, preference);
    log.info("model icon preference written", { provider, modelId, preference, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ preferences });
  } catch (error) {
    log.error("model icon preference write failed", { error, provider, modelId, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
