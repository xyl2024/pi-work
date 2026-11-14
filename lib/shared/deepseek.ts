export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

export const DEEPSEEK_ASR_PATH = "/v1/tools/asr";

export type DeepSeekTranscriptionErrorCode =
  | "missing_key"
  | "invalid_audio"
  | "too_large"
  | "rate_limited"
  | "busy"
  | "timeout"
  | "aborted"
  | "failed";

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
