export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

export const DEEPSEEK_ASR_PATH = "/v1/tools/asr";

export const DEEPSEEK_SYNTHESIS_PATH = "/v1/tools/tts";

export type DeepSeekTranscriptionErrorCode =
  | "missing_key"
  | "invalid_audio"
  | "too_large"
  | "rate_limited"
  | "busy"
  | "timeout"
  | "aborted"
  | "failed";

export const DEEPSEEK_TRANSCRIPTION_ERROR_STATUS = {
  missing_key: 409,
  invalid_audio: 400,
  too_large: 413,
  rate_limited: 429,
  busy: 503,
  timeout: 504,
  failed: 502,
  aborted: 502,
} as const satisfies Record<DeepSeekTranscriptionErrorCode, number>;

export function deepSeekTranscriptionErrorCodeForStatus(
  status: number,
): DeepSeekTranscriptionErrorCode {
  const entries = Object.entries(DEEPSEEK_TRANSCRIPTION_ERROR_STATUS) as Array<
    [DeepSeekTranscriptionErrorCode, number]
  >;
  return entries.find(([, value]) => value === status)?.[0] ?? "failed";
}

export type DeepSeekSynthesisErrorCode =
  | "missing_key"
  | "too_long"
  | "blocked"
  | "rate_limited"
  | "busy"
  | "timeout"
  | "failed";

export const DEEPSEEK_SYNTHESIS_ERROR_STATUS = {
  missing_key: 409,
  too_long: 413,
  blocked: 422,
  rate_limited: 429,
  busy: 503,
  timeout: 504,
  failed: 502,
} as const satisfies Record<DeepSeekSynthesisErrorCode, number>;

export function deepSeekSynthesisErrorCodeForStatus(status: number): DeepSeekSynthesisErrorCode {
  if (status === 400 || status === 422) return "blocked";
  if (status === 401) return "missing_key";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "too_long";
  if (status === 429) return "rate_limited";
  if (status === 503) return "busy";
  return "failed";
}

export interface DeepSeekTranscription {
  text: string;
  durationMs: number | null;
}

export type DeepSeekApiKeySource = "file" | "env";

export interface DeepSeekApiKeyStatus {
  configured: boolean;
  source: DeepSeekApiKeySource | null;
  masked: string | null;
}
