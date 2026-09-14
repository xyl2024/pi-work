// Context-window occupancy signal — the tiering shared by every context ring
// in the app (chat top bar `ContextUsageBar`, kanban card `CardContextRing`).
//
// Tiers are keyed on the ABSOLUTE number of context tokens, not on the percent
// of the model's window: what degrades the model is the size of the prompt, and
// 125k means the same thing whether the window is 200k or 1M. Both consumers
// must agree on this, so the thresholds, palette and warning copy live here
// instead of being copy-pasted per component.

/** Context size (tokens) at which the ring turns orange: the model is leaving
 *  its high-recall "Smart Zone" and hallucination becomes plausible. */
export const CONTEXT_WARN_TOKENS = 125_000;

/** Context size (tokens) at which the ring turns red: the model is expected to
 *  hallucinate heavily and the session should be compacted or restarted. */
export const CONTEXT_DANGER_TOKENS = 250_000;

export type ContextUsageTier = "ok" | "warn" | "danger";

/** Untranslated i18n keys for the tooltip warning lines. Component call sites
 *  pass them through `t()`; they are exported so the dictionary and the UI can
 *  be grepped against each other. */
export const CONTEXT_WARN_MESSAGE =
  "You are leaving the model's Smart Zone — hallucinations become possible.";
export const CONTEXT_DANGER_MESSAGE =
  "Context is nearly full — the model will hallucinate badly. Compact the session or start a new one.";

export interface ContextUsageSignal {
  tier: ContextUsageTier;
  /** Solid color for the ring arc and its label — solid, not a gradient, so it
   *  stays readable at the 10–14px the rings are rendered at. */
  color: string;
  /** Warning line for the tooltip, or `null` while the context is still safe.
   *  The tiers are mutually exclusive: past 250k the stronger wording replaces
   *  the Smart Zone notice rather than stacking a milder sentence on top. */
  warning: string | null;
}

/** Tier the given context size falls into. `tokens` is the absolute number of
 *  tokens currently occupying the context window (not a percentage). */
export function contextUsageSignal(tokens: number): ContextUsageSignal {
  if (tokens >= CONTEXT_DANGER_TOKENS) {
    return { tier: "danger", color: "#ef4444", warning: CONTEXT_DANGER_MESSAGE };
  }
  if (tokens >= CONTEXT_WARN_TOKENS) {
    return { tier: "warn", color: "#f97316", warning: CONTEXT_WARN_MESSAGE };
  }
  return { tier: "ok", color: "var(--accent)", warning: null };
}

/** Absolute token count with a `K` unit, one decimal: 124,800 → "124.8K".
 *  Used as the visible label next to the rings so the number reads as a budget
 *  against the thresholds above instead of a bare percentage. */
export function formatContextTokensK(tokens: number): string {
  return `${(tokens / 1000).toFixed(1)}K`;
}

/** Context window size for the `/ 200k` readout: compact, no decimals in the
 *  thousands range (200000 → "200k", 1000000 → "1.0M"). */
export function formatContextWindowCompact(contextWindow: number): string {
  if (contextWindow >= 1_000_000) return `${(contextWindow / 1_000_000).toFixed(1)}M`;
  if (contextWindow >= 1000) return `${(contextWindow / 1000).toFixed(0)}k`;
  return String(contextWindow);
}
