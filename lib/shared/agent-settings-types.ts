export interface ProviderRetryConfig {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface AgentRetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  provider: ProviderRetryConfig;
}

export const DEFAULT_AGENT_RETRY: AgentRetryConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: {
    maxRetryDelayMs: 60000,
  },
};

export const RETRY_LIMITS = {
  maxRetries: { min: 0, max: 10 },
  baseDelayMs: { min: 100, max: 60_000 },
  provider: {
    timeoutMs: { min: 1_000, max: 3_600_000 },
    maxRetries: { min: 0, max: 10 },
    maxRetryDelayMs: { min: 0, max: 300_000 },
  },
} as const;

export function formatBackoffPreview(baseDelayMs: number, maxRetries: number): {
  shown: number[];
  total: number;
} {
  const total = Math.max(0, Math.floor(maxRetries));
  const all: number[] = [];
  for (let i = 0; i < total; i++) {
    all.push(Math.round((baseDelayMs * 2 ** i) / 1000));
  }
  return { shown: all.slice(0, 3), total };
}