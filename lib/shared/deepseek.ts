export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

export type DeepSeekApiKeySource = "file" | "env";

export interface DeepSeekApiKeyStatus {
  configured: boolean;
  source: DeepSeekApiKeySource | null;
  masked: string | null;
}
