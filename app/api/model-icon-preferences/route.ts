import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { readModelIconPreferences, setModelIconPreference } from "@/lib/server/model-icon-preferences";
import {
  MODEL_ICON_PREFERENCE_AUTO,
  MODEL_ICON_PREFERENCE_PROVIDER,
} from "@/lib/shared/model-icon-match";

export const dynamic = "force-dynamic";

const log = createLogger("api/model-icon-preferences");

const MAX_IDENTIFIER_LENGTH = 200;

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
  if (provider.length > MAX_IDENTIFIER_LENGTH || modelId.length > MAX_IDENTIFIER_LENGTH) {
    return NextResponse.json(
      { error: `provider and modelId must be at most ${MAX_IDENTIFIER_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (preference !== MODEL_ICON_PREFERENCE_PROVIDER && preference !== MODEL_ICON_PREFERENCE_AUTO) {
    return NextResponse.json(
      { error: `preference must be "${MODEL_ICON_PREFERENCE_PROVIDER}" or "${MODEL_ICON_PREFERENCE_AUTO}"` },
      { status: 400 },
    );
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
