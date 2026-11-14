import { NextResponse } from "next/server";
import { createDeepSeekClient } from "@/lib/server/deepseek/client";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { DEEPSEEK_TRANSCRIPTION_ERROR_STATUS } from "@/lib/shared/deepseek";
import { VOICE_INPUT_MAX_BYTES, VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS } from "@/lib/shared/voice-input";

const log = createLogger("api/voice/transcribe");

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || !file.type.startsWith("audio/")) {
      return NextResponse.json({ error: "invalid_audio" }, { status: 400 });
    }
    if (file.size > VOICE_INPUT_MAX_BYTES) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }

    const audio = new Uint8Array(await file.arrayBuffer());
    const result = await createDeepSeekClient({
      timeoutMs: VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS,
    }).transcribe({ audio, mimeType: file.type });

    if (!result.ok) {
      const status = DEEPSEEK_TRANSCRIPTION_ERROR_STATUS[result.code];
      log.error("voice transcription failed", {
        code: result.code,
        status,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: result.code }, { status });
    }

    log.info("voice transcription completed", {
      bytes: audio.byteLength,
      textLength: result.data.text.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ text: result.data.text });
  } catch (error) {
    log.error("voice transcription route failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
