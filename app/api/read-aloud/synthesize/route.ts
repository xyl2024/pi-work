import { NextResponse } from "next/server";
import { createDeepSeekClient } from "@/lib/server/deepseek/client";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { DEEPSEEK_SYNTHESIS_ERROR_STATUS } from "@/lib/shared/deepseek";
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
    if (readAloudBillingChars(text) > READ_ALOUD_MAX_BILLING_CHARS) {
      return NextResponse.json({ error: "too_long" }, { status: 413 });
    }

    const result = await createDeepSeekClient({
      timeoutMs: READ_ALOUD_SYNTHESIZE_TIMEOUT_MS,
    }).synthesize({ text, voiceId: readAloudVoiceId(body.voiceId) });

    if (!result.ok) {
      const status = DEEPSEEK_SYNTHESIS_ERROR_STATUS[result.code];
      log.error("read-aloud synthesis failed", {
        code: result.code,
        status,
        billingChars: readAloudBillingChars(text),
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: result.code }, { status });
    }

    log.info("read-aloud synthesis completed", {
      bytes: result.data.audio.byteLength,
      billingChars: readAloudBillingChars(text),
      durationMs: elapsedMs(startedAt),
    });
    const audio = new Uint8Array(result.data.audio.byteLength);
    audio.set(result.data.audio);
    return new NextResponse(new Blob([audio], { type: "audio/wav" }), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(result.data.audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("read-aloud synthesis route failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
