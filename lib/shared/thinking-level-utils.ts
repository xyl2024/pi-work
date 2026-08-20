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
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

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
  "max",
] as const;

/**
 * Pick the highest thinking level the given model actually supports.
 * Walks THINKING_LEVEL_ORDER from strongest (max) to weakest (off)
 * and returns the first one present in `available`. Falls back to
 * "off" when no reasoning-capable levels are advertised — that is the
 * safe default for non-reasoning models and matches what pi does when
 * the model has `reasoning === false`.
 */
export function pickHighestAvailableThinkingLevel(
  available: readonly string[] | null | undefined,
): ThinkingLevelOption {
  const list = available ?? [];
  for (let i = THINKING_LEVEL_ORDER.length - 1; i >= 0; i--) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (list.includes(candidate)) return candidate;
  }
  return "off";
}

/**
 * Pick a middle-of-the-road thinking level the given model supports.
 * Used as the default for brand-new sessions: pick the model's
 * strongest non-extreme option so the user starts somewhere sensible
 * rather than at either ceiling.
 *
 * Algorithm:
 * 1. Project `available` onto the canonical THINKING_LEVEL_ORDER
 *    (weakest → strongest), preserving that order. Some models expose
 *    levels in arbitrary order; the canonical order is what makes
 *    "middle" meaningful.
 * 2. Pick `Math.floor((len - 1) / 2)`. With an odd length that lands
 *    exactly on the central index; with an even length it lands on
 *    the lower-of-the-two middle indices (i.e. biases toward the
 *    weaker side, never toward max).
 *
 * Examples:
 *   [off, low, medium, high]  → low       (4 items, floor((4-1)/2)=1)
 *   [off, medium, high]       → medium    (3 items, floor((3-1)/2)=1)
 *   [off, high]               → off       (2 items, floor((2-1)/2)=0)
 *   [off]                     → off
 *
 * Falls back to "off" when no reasoning-capable levels are advertised —
 * same safe default as pickHighestAvailableThinkingLevel for
 * non-reasoning models.
 */
export function pickMiddleAvailableThinkingLevel(
  available: readonly string[] | null | undefined,
): ThinkingLevelOption {
  const list = available ?? [];
  const supported: ThinkingLevelOption[] = [];
  for (const level of THINKING_LEVEL_ORDER) {
    if (list.includes(level)) supported.push(level);
  }
  if (supported.length === 0) return "off";
  const idx = Math.floor((supported.length - 1) / 2);
  return supported[idx];
}

/**
 * Pick the closest available thinking level for the requested value.
 * Mirrors pi-ai's `clampThinkingLevel` semantics: if the requested
 * level isn't supported by the model, walk forward in
 * THINKING_LEVEL_ORDER first (preferring a stronger reasoning step),
 * then backward. Falls back to the first available level when nothing
 * matches, or to "off" if the available list is empty.
 */
export function pickClosestAvailableThinkingLevel(
  requested: ThinkingLevelOption,
  available: readonly string[] | null | undefined,
): ThinkingLevelOption {
  const list = available ?? [];
  if (list.length === 0) return requested;
  if (list.includes(requested)) return requested;
  const idx = (THINKING_LEVEL_ORDER as readonly string[]).indexOf(requested);
  if (idx === -1) return (list[0] as ThinkingLevelOption) ?? "off";
  for (let i = idx; i < THINKING_LEVEL_ORDER.length; i++) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (list.includes(candidate)) return candidate as ThinkingLevelOption;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (list.includes(candidate)) return candidate as ThinkingLevelOption;
  }
  return (list[0] as ThinkingLevelOption) ?? "off";
}