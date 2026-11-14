export const VOICE_INPUT_SAMPLE_RATE = 16000;

export const VOICE_INPUT_MAX_DURATION_MS = 120_000;

export const VOICE_INPUT_MIN_DURATION_MS = 500;

export const VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS = 60_000;

export const VOICE_INPUT_MAX_BYTES = 8 * 1024 * 1024;

export type VoiceInputPhase = "idle" | "recording" | "transcribing";

export interface VoiceInputState {
  phase: VoiceInputPhase;
  elapsedMs: number;
  level: number;
}

export type VoiceInputErrorCode =
  | "missing_key"
  | "permission_denied"
  | "empty_transcript"
  | "rate_limited"
  | "too_large"
  | "busy"
  | "timeout"
  | "invalid_audio"
  | "failed";

const ERROR_MESSAGE_KEYS: Record<VoiceInputErrorCode, string> = {
  missing_key: "DeepSeek API key is not configured",
  permission_denied: "Microphone access was denied",
  empty_transcript: "Didn't catch that, say it again",
  rate_limited: "Voice input is busy, try again",
  too_large: "Voice input is too long",
  busy: "Voice input is busy, try again",
  timeout: "Voice input timed out",
  invalid_audio: "Voice input failed",
  failed: "Voice input failed",
};

export function voiceInputErrorMessageKey(code: VoiceInputErrorCode): string {
  return ERROR_MESSAGE_KEYS[code];
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export function encodePcm16Wav(chunks: Int16Array[], sampleRate: number): Uint8Array {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      view.setInt16(offset, chunk[i], true);
      offset += 2;
    }
  }

  return bytes;
}
