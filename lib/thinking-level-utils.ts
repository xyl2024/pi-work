// Shared helpers for reasoning about a model's thinking level support.
//
// Both the chat input (components/ChatInput.tsx) and the scheduler
// form (components/Scheduler/TaskFormModal.tsx) drive a per-model
// thinking level dropdown and need to fall back when the user's
// current pick isn't supported by the freshly-selected model. Keeping
// the fallback rule in one place means chat and scheduler always
// agree on what "closest available" means — and that matches pi-ai's
// `clampThinkingLevel` semantics, so the server-side silent clamp
// never disagrees with what the UI shows.

export type ThinkingLevelOption =
  | "auto"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

// Canonical ordering of explicit thinking levels, mirroring
// EXTENDED_THINKING_LEVELS in @earendil-works/pi-ai (which our pi
// build uses to clamp unsupported levels to the nearest available
// one). We keep this local rather than importing from pi-ai to avoid
// pulling server-only deps into the client bundle.
export const THINKING_LEVEL_ORDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

/**
 * Pick the closest available thinking level for the requested value.
 * Mirrors pi-ai's `clampThinkingLevel` semantics: if the requested
 * level isn't supported by the model, walk forward in
 * THINKING_LEVEL_ORDER first (preferring a stronger reasoning step),
 * then backward. "auto" never needs clamping (it represents "let the
 * model decide" and is accepted by every model). Falls back to the
 * first available level when nothing matches, or to "auto" if the
 * available list is empty.
 */
export function pickClosestAvailableThinkingLevel(
  requested: ThinkingLevelOption,
  available: readonly string[] | null | undefined,
): ThinkingLevelOption {
  if (requested === "auto") return "auto";
  const list = available ?? [];
  if (list.length === 0) return requested;
  if (list.includes(requested)) return requested;
  const idx = (THINKING_LEVEL_ORDER as readonly string[]).indexOf(requested);
  if (idx === -1) return (list[0] as ThinkingLevelOption) ?? "auto";
  for (let i = idx; i < THINKING_LEVEL_ORDER.length; i++) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (list.includes(candidate)) return candidate as ThinkingLevelOption;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (list.includes(candidate)) return candidate as ThinkingLevelOption;
  }
  return (list[0] as ThinkingLevelOption) ?? "auto";
}