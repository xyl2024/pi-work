import { NextResponse } from "next/server";
import { createDeepSeekClient } from "@/lib/server/deepseek/client";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  coalesceSynthesis,
  createSynthesisCache,
  synthesisCacheKey,
} from "@/lib/server/synthesis-cache";
import { DEEPSEEK_SYNTHESIS_ERROR_STATUS } from "@/lib/shared/deepseek";
import type { DeepSeekSynthesisErrorCode } from "@/lib/shared/deepseek";
import {
  READ_ALOUD_MAX_BILLING_CHARS,
  READ_ALOUD_SYNTHESIZE_TIMEOUT_MS,
  hasReadableReadAloudText,
  readAloudBillingChars,
  readAloudVoiceId,
  shapeReadAloudText,
} from "@/lib/shared/read-aloud";

const log = createLogger("api/read-aloud/synthesize");

export const dynamic = "force-dynamic";

interface SynthesisRequestBody {
  text?: unknown;
  voiceId?: unknown;
}

type SynthesisOutcome =
  | { ok: true; audio: Uint8Array; cached: boolean }
  | { ok: false; code: DeepSeekSynthesisErrorCode };

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    let body: SynthesisRequestBody;
    try {
      body = (await req.json()) as SynthesisRequestBody;
    } catch {
      return NextResponse.json({ error: "blocked" }, { status: 400 });
    }

    const text = shapeReadAloudText(typeof body.text === "string" ? body.text : "");
    if (!hasReadableReadAloudText(text)) {
      return NextResponse.json({ error: "blocked" }, { status: 400 });
    }
    const billingChars = readAloudBillingChars(text);
    if (billingChars > READ_ALOUD_MAX_BILLING_CHARS) {
      return NextResponse.json({ error: "too_long" }, { status: 413 });
    }

    const voiceId = readAloudVoiceId(body.voiceId);
    const cache = createSynthesisCache();
    const key = synthesisCacheKey(text, voiceId);

    const result = await coalesceSynthesis(key, async (): Promise<SynthesisOutcome> => {
      const cached = await cache.read(key);
      if (cached) return { ok: true, audio: cached, cached: true };

      const synthesized = await createDeepSeekClient({
        timeoutMs: READ_ALOUD_SYNTHESIZE_TIMEOUT_MS,
      }).synthesize({ text, voiceId });
      if (!synthesized.ok) return { ok: false, code: synthesized.code };

      await cache.write(key, synthesized.data.audio);
      return { ok: true, audio: synthesized.data.audio, cached: false };
    });

    if (!result.ok) {
      const status = DEEPSEEK_SYNTHESIS_ERROR_STATUS[result.code];
      log.error("read-aloud synthesis failed", {
        code: result.code,
        status,
        billingChars,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: result.code }, { status });
    }

    const audio = new Uint8Array(result.audio.byteLength);
    audio.set(result.audio);
    log.info("read-aloud synthesis completed", {
      bytes: audio.byteLength,
      cached: result.cached,
      billingChars,
      durationMs: elapsedMs(startedAt),
    });
    return new NextResponse(new Blob([audio], { type: "audio/wav" }), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("read-aloud synthesis route failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
