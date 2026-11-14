import {
  VOICE_INPUT_ERROR_CODES,
  VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS,
  voiceInputErrorCodeForStatus,
  type VoiceInputErrorCode,
} from "@/lib/shared/voice-input";

export type VoiceTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; code: VoiceInputErrorCode };

export interface VoiceTranscribeOptions {
  signal?: AbortSignal;
}

function isVoiceInputErrorCode(value: unknown): value is VoiceInputErrorCode {
  return (
    typeof value === "string" && (VOICE_INPUT_ERROR_CODES as readonly string[]).includes(value)
  );
}

async function errorCodeFrom(response: Response): Promise<VoiceInputErrorCode> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (isVoiceInputErrorCode(body.error)) return body.error;
  } catch {
    return voiceInputErrorCodeForStatus(response.status);
  }
  return voiceInputErrorCodeForStatus(response.status);
}

export async function transcribeVoiceAudio(
  wav: Uint8Array,
  options: VoiceTranscribeOptions = {},
): Promise<VoiceTranscribeResult> {
  const timeout = AbortSignal.timeout(VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const form = new FormData();
  const bytes = new Uint8Array(wav.byteLength);
  bytes.set(wav);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "voice-input.wav");

  let response: Response;
  try {
    response = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal });
  } catch (error) {
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? (error as { name: unknown }).name
        : null;
    if (name === "TimeoutError") return { ok: false, code: "timeout" };
    return { ok: false, code: "failed" };
  }

  if (!response.ok) return { ok: false, code: await errorCodeFrom(response) };

  try {
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string") return { ok: false, code: "failed" };
    return { ok: true, text: body.text };
  } catch {
    return { ok: false, code: "failed" };
  }
}
