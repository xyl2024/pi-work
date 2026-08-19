import type { ModelEntry, RuntimeModelInfo } from "./types";
import { DEEPSEEK_COMPAT, THINKING_LEVELS } from "./constants";

export function getDisplayedThinkingLevels(model: RuntimeModelInfo): string[] {
  if (!model.reasoning) return [];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

export function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

export function cloneModelFromCatalog(source: RuntimeModelInfo): ModelEntry {
  return {
    id: source.id,
    name: source.name,
    api: source.api,
    reasoning: source.reasoning,
    thinkingLevelMap: source.thinkingLevelMap ? { ...source.thinkingLevelMap } : undefined,
    input: [...source.input],
    contextWindow: source.contextWindow,
    maxTokens: source.maxTokens,
    cost: {
      input: source.cost.input,
      output: source.cost.output,
      cacheRead: source.cost.cacheRead,
      cacheWrite: source.cost.cacheWrite,
      tiers: source.cost.tiers ? [...source.cost.tiers] : undefined,
    },
    compat: source.compat ? { ...source.compat } : undefined,
  };
}
