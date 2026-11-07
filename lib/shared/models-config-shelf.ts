import type { ApiKeyProvider, OAuthProvider } from "./models-config";
import {
  byModelsConfigRowName,
  modelsConfigProviderKindTitle,
  MODELS_CONFIG_PROVIDER_KIND_ORDER,
  type ModelsConfigProviderKind,
  type ModelsConfigSection,
} from "./models-config-filter";

export type ModelsConfigShelfAction = "connect" | "configure" | "create";

export interface ModelsConfigShelfRow {
  key: string;
  id: string;
  name: string;
  kind: ModelsConfigProviderKind;
  action: ModelsConfigShelfAction;
  actionLabelKey: string;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  keywords: readonly string[];
}

export type ModelsConfigShelfSection = ModelsConfigSection<ModelsConfigShelfRow>;

const CUSTOM_KEYWORDS = ["custom", "openai-compatible", "anthropic-compatible", "base url", "api key"];

function subscriptionRow(provider: OAuthProvider): ModelsConfigShelfRow {
  return {
    key: `subscription:${provider.id}`,
    id: provider.id,
    name: provider.name,
    kind: "subscription",
    action: "connect",
    actionLabelKey: "Connect",
    summaryKey: "Subscription · OAuth sign-in",
    summaryParams: {},
    keywords: ["subscription", "oauth", "sign in", "login"],
  };
}

function apiKeyRow(provider: ApiKeyProvider): ModelsConfigShelfRow {
  return {
    key: `apiKey:${provider.id}`,
    id: provider.id,
    name: provider.displayName,
    kind: "apiKey",
    action: "configure",
    actionLabelKey: "Configure",
    summaryKey: "API Key · {n} models",
    summaryParams: { n: provider.modelCount },
    keywords: ["api key"],
  };
}

function customRow(keywords: readonly string[]): ModelsConfigShelfRow {
  return {
    key: "custom:custom",
    id: "custom",
    name: "OpenAI / Anthropic compatible",
    kind: "custom",
    action: "create",
    actionLabelKey: "Create",
    summaryKey: "Custom · Base URL + Key",
    summaryParams: {},
    keywords: [...CUSTOM_KEYWORDS, ...keywords],
  };
}

export function modelsConfigShelfSections(input: {
  oauthProviders: readonly OAuthProvider[];
  apiKeyProviders: readonly ApiKeyProvider[];
  customKeywords?: readonly string[];
}): ModelsConfigShelfSection[] {
  const rows: Record<ModelsConfigProviderKind, ModelsConfigShelfRow[]> = {
    subscription: input.oauthProviders.filter((provider) => !provider.loggedIn).map(subscriptionRow),
    apiKey: input.apiKeyProviders.filter((provider) => !provider.configured).map(apiKeyRow),
    custom: [customRow(input.customKeywords ?? [])],
  };

  return MODELS_CONFIG_PROVIDER_KIND_ORDER.map((kind) => ({
    kind,
    titleKey: modelsConfigProviderKindTitle(kind),
    rows: rows[kind].sort(byModelsConfigRowName),
  }));
}

function matches(row: ModelsConfigShelfRow, needle: string): boolean {
  if (row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)) return true;
  return row.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
}

export function filterModelsConfigShelfSections(
  sections: readonly ModelsConfigShelfSection[],
  query: string,
): ModelsConfigShelfSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => matches(row, needle));
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

export function countModelsConfigShelfRows(
  sections: readonly ModelsConfigShelfSection[],
): number {
  return sections.reduce((total, section) => total + section.rows.length, 0);
}
