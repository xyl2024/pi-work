import {
  VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS,
  type VoiceInputErrorCode,
} from "@/lib/shared/voice-input";

export type VoiceTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; code: VoiceInputErrorCode };

export interface VoiceTranscribeOptions {
  signal?: AbortSignal;
}

const KNOWN_CODES: readonly VoiceInputErrorCode[] = [
  "missing_key",
  "permission_denied",
  "empty_transcript",
  "rate_limited",
  "too_large",
  "busy",
  "timeout",
  "invalid_audio",
  "failed",
];

function isVoiceInputErrorCode(value: unknown): value is VoiceInputErrorCode {
  return typeof value === "string" && (KNOWN_CODES as readonly string[]).includes(value);
}

function statusCode(status: number): VoiceInputErrorCode {
  if (status === 409) return "missing_key";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status === 503) return "busy";
  if (status === 504) return "timeout";
  if (status === 400) return "invalid_audio";
  return "failed";
}

async function errorCodeFrom(response: Response): Promise<VoiceInputErrorCode> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (isVoiceInputErrorCode(body.error)) return body.error;
  } catch {
    return statusCode(response.status);
  }
  return statusCode(response.status);
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
    if (error instanceof Error && error.name === "TimeoutError") return { ok: false, code: "timeout" };
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
