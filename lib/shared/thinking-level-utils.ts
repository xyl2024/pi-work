export type ThinkingLevelOption =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const THINKING_LEVEL_ORDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

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