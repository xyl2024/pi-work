/**
 * Model icon auto-match (图标自动匹配): derive a brand icon id from a model id.
 *
 * Pure string rules — no fs/path/Node/React — so both the server and the
 * client can share one table. Icon ids are the icon library's provider ids;
 * the client layer decides what to render for an id it does not know.
 */

/** Preference value meaning "show the provider icon instead of the auto match". */
export const MODEL_ICON_PREFERENCE_PROVIDER = "provider";

/**
 * 图标偏好 (icon preference): keyed by `provider:modelId`. Only real
 * deviations are stored — `provider` means "use the provider icon"; the
 * absence of an entry means "use the auto match".
 */
export type ModelIconPreferences = Record<string, string>;

type ModelIconMatch = {
  /** Lowercase prefix or, when `exact` is set, the whole normalized model id. */
  readonly match: string;
  /** Icon-library provider id of the brand's main icon. */
  readonly icon: string;
  readonly exact?: boolean;
};

/**
 * Ordered prefix/alias table. First hit wins, so more specific entries go
 * first. Only families that have an icon in the icon library are listed;
 * `llama` / `meta` deliberately have no entry. Every entry points at the
 * brand's main icon — never coding / token-plan / cn variants.
 */
const MODEL_ICON_MATCHES: readonly ModelIconMatch[] = [
  { match: "claude", icon: "anthropic" },
  // OpenAI: the gpt prefix covers gpt-5 / gpt-4o; o-series are bare ids, so
  // they are exact aliases — a bare "o" prefix would swallow "openrouter".
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

/** Match a model id to an icon-library brand icon id, or undefined. */
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

/** Preference key for one model: `provider:modelId`. */
export function modelIconPreferenceKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/** True when the user explicitly switched this model back to the provider icon. */
export function isProviderIconPreferred(
  preferences: ModelIconPreferences | null | undefined,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): boolean {
  if (!preferences || !provider || !modelId) return false;
  return preferences[modelIconPreferenceKey(provider, modelId)] === MODEL_ICON_PREFERENCE_PROVIDER;
}

/**
 * Whether the UI should offer the auto-match ↔ provider-icon toggle: only when
 * the model auto-matches and the result differs from the provider icon. If
 * the two are the same there is nothing to switch. Explicit model-level icons
 * do not hide the toggle; custom providers never show it (a UI-layer rule).
 */
export function canToggleModelIcon(
  modelId: string | null | undefined,
  providerIconId: string | null | undefined,
): boolean {
  const match = matchModelIcon(modelId);
  return match !== undefined && match !== providerIconId;
}
