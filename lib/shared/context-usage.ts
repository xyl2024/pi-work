export const CONTEXT_WARN_TOKENS = 125_000;

export const CONTEXT_DANGER_TOKENS = 250_000;

export type ContextUsageTier = "ok" | "warn" | "danger";

export const CONTEXT_WARN_MESSAGE =
  "You are leaving the model's Smart Zone — hallucinations become possible.";
export const CONTEXT_DANGER_MESSAGE =
  "Context is nearly full — the model will hallucinate badly. Compact the session or start a new one.";

export interface ContextUsageSignal {
  tier: ContextUsageTier;
  color: string;
  warning: string | null;
}

export function contextUsageSignal(tokens: number): ContextUsageSignal {
  if (tokens >= CONTEXT_DANGER_TOKENS) {
    return { tier: "danger", color: "#ef4444", warning: CONTEXT_DANGER_MESSAGE };
  }
  if (tokens >= CONTEXT_WARN_TOKENS) {
    return { tier: "warn", color: "#f97316", warning: CONTEXT_WARN_MESSAGE };
  }
  return { tier: "ok", color: "var(--accent)", warning: null };
}

export function formatContextTokensK(tokens: number): string {
  return `${(tokens / 1000).toFixed(1)}K`;
}

export function formatContextWindowCompact(contextWindow: number): string {
  if (contextWindow >= 1_000_000) return `${(contextWindow / 1_000_000).toFixed(1)}M`;
  if (contextWindow >= 1000) return `${(contextWindow / 1000).toFixed(0)}k`;
  return String(contextWindow);
}
