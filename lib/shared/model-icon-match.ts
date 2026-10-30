export const MODEL_ICON_PREFERENCE_PROVIDER = "provider";

export const MODEL_ICON_PREFERENCE_AUTO = "auto";

export type ModelIconPreference =
  | typeof MODEL_ICON_PREFERENCE_PROVIDER
  | typeof MODEL_ICON_PREFERENCE_AUTO;

export type ModelIconPreferences = Record<string, string>;

type ModelIconMatch = {
  readonly match: string;
  readonly icon: string;
  readonly exact?: boolean;
};

const MODEL_ICON_MATCHES: readonly ModelIconMatch[] = [
  { match: "claude", icon: "anthropic" },
  { match: "gpt", icon: "openai" },
  { match: "codex", icon: "openai" },
  { match: "chatgpt", icon: "openai" },
  { match: "o1", icon: "openai" },
  { match: "o3", icon: "openai", exact: true },
  { match: "o4", icon: "openai", exact: true },
  { match: "gemini", icon: "google" },
  { match: "deepseek", icon: "deepseek" },
  { match: "glm", icon: "zai" },
  { match: "chatglm", icon: "zai" },
  { match: "kimi", icon: "moonshotai" },
  { match: "moonshot", icon: "moonshotai" },
  { match: "qwen", icon: "qwen" },
  { match: "qwq", icon: "qwen" },
  { match: "minimax", icon: "minimax" },
  { match: "abab", icon: "minimax" },
  { match: "mistral", icon: "mistral" },
  { match: "mixtral", icon: "mistral" },
  { match: "grok", icon: "xai" },
];

export function matchModelIcon(modelId: string | null | undefined): string | undefined {
  if (!modelId) return undefined;
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return undefined;
  for (const entry of MODEL_ICON_MATCHES) {
    const hit = entry.exact ? normalized === entry.match : normalized.startsWith(entry.match);
    if (hit) return entry.icon;
  }
  return undefined;
}

export function normalizeModelIconPreferences(value: unknown): ModelIconPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ModelIconPreferences = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key || raw !== MODEL_ICON_PREFERENCE_PROVIDER) continue;
    result[key] = MODEL_ICON_PREFERENCE_PROVIDER;
  }
  return result;
}

export function modelIconPreferenceKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export function isProviderIconPreferred(
  preferences: ModelIconPreferences | null | undefined,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): boolean {
  if (!preferences || !provider || !modelId) return false;
  return preferences[modelIconPreferenceKey(provider, modelId)] === MODEL_ICON_PREFERENCE_PROVIDER;
}

export function canToggleModelIcon(
  modelId: string | null | undefined,
  providerIconId: string | null | undefined,
  explicitModelIconId?: string | null,
): boolean {
  if (explicitModelIconId) return false;
  const match = matchModelIcon(modelId);
  return match !== undefined && match !== providerIconId;
}

export function resolveModelIconId(
  provider: string | null | undefined,
  model: string | null | undefined,
  modelIcons: Record<string, string> | null | undefined,
  preferences: ModelIconPreferences | null | undefined,
  isKnownIcon: (iconId: string) => boolean,
): string | undefined {
  if (model) {
    const explicit = (provider ? modelIcons?.[modelIconPreferenceKey(provider, model)] : undefined)
      ?? modelIcons?.[model];
    if (explicit && isKnownIcon(explicit)) return explicit;
  }
  if (model && !isProviderIconPreferred(preferences, provider, model)) {
    const matched = matchModelIcon(model);
    if (matched && isKnownIcon(matched)) return matched;
  }
  if (provider) {
    const providerIcon = modelIcons?.[provider];
    if (providerIcon && isKnownIcon(providerIcon)) return providerIcon;
    if (isKnownIcon(provider)) return provider;
  }
  return undefined;
}
