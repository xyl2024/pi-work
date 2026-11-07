import type { ApiKeyProvider, ModelEntry, OAuthProvider, ProviderEntry } from "./models-config";

export type ModelsConfigProviderKind = "subscription" | "apiKey" | "custom";

export interface ModelsConfigProviderModel {
  id: string;
  name: string;
}

export interface ModelsConfigProviderRow {
  key: string;
  id: string;
  name: string;
  kind: ModelsConfigProviderKind;
  modelCount: number;
  models: ModelsConfigProviderModel[];
  matchedModels: string[];
  changed: boolean;
}

export interface ModelsConfigSection<Row> {
  kind: ModelsConfigProviderKind;
  titleKey: string;
  rows: Row[];
}

export type ModelsConfigProviderSection = ModelsConfigSection<ModelsConfigProviderRow>;

export interface ModelsConfigProviderKindInfo {
  kind: ModelsConfigProviderKind;
  titleKey: string;
  labelKey: string;
}

export const MODELS_CONFIG_PROVIDER_KIND_INFO: Record<ModelsConfigProviderKind, ModelsConfigProviderKindInfo> = {
  subscription: { kind: "subscription", titleKey: "Subscriptions", labelKey: "Subscription" },
  apiKey: { kind: "apiKey", titleKey: "API Keys", labelKey: "API Key" },
  custom: { kind: "custom", titleKey: "Custom providers", labelKey: "Custom" },
};

export const MODELS_CONFIG_PROVIDER_KIND_ORDER: ModelsConfigProviderKind[] = ["subscription", "apiKey", "custom"];

export function modelsConfigProviderKindLabel(kind: ModelsConfigProviderKind): string {
  return MODELS_CONFIG_PROVIDER_KIND_INFO[kind].labelKey;
}

export function modelsConfigProviderKindTitle(kind: ModelsConfigProviderKind): string {
  return MODELS_CONFIG_PROVIDER_KIND_INFO[kind].titleKey;
}

export function byModelsConfigRowName(left: { id: string; name: string }, right: { id: string; name: string }): number {
  const nameOrder = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
  return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
}

function customModels(provider: ProviderEntry | undefined): ModelsConfigProviderModel[] {
  return (provider?.models ?? []).map((model: ModelEntry) => ({
    id: model.id,
    name: model.name?.trim() || model.id,
  }));
}

function row(input: {
  kind: ModelsConfigProviderKind;
  id: string;
  name: string;
  modelCount: number;
  models: ModelsConfigProviderModel[];
  changed: boolean;
}): ModelsConfigProviderRow {
  return {
    key: `${input.kind}:${input.id}`,
    id: input.id,
    name: input.name,
    kind: input.kind,
    modelCount: input.modelCount,
    models: input.models,
    matchedModels: [],
    changed: input.changed,
  };
}

export function modelsConfigProviderSections(input: {
  oauthProviders: readonly OAuthProvider[];
  apiKeyProviders: readonly ApiKeyProvider[];
  providers: Record<string, ProviderEntry>;
  providerNames?: Record<string, string>;
  changedProviders?: readonly string[];
}): ModelsConfigProviderSection[] {
  const changed = new Set(input.changedProviders ?? []);
  const rows: Record<ModelsConfigProviderKind, ModelsConfigProviderRow[]> = {
    subscription: input.oauthProviders
      .filter((provider) => provider.loggedIn)
      .map((provider) =>
        row({
          kind: "subscription",
          id: provider.id,
          name: provider.name,
          modelCount: 0,
          models: [],
          changed: false,
        }),
      ),
    apiKey: input.apiKeyProviders
      .filter((provider) => provider.configured)
      .map((provider) =>
        row({
          kind: "apiKey",
          id: provider.id,
          name: provider.displayName,
          modelCount: provider.modelCount,
          models: [],
          changed: false,
        }),
      ),
    custom: Object.entries(input.providers).map(([name, provider]) =>
      row({
        kind: "custom",
        id: name,
        name: input.providerNames?.[name]?.trim() || name,
        modelCount: provider.models?.length ?? 0,
        models: customModels(provider),
        changed: changed.has(name),
      }),
    ),
  };

  return MODELS_CONFIG_PROVIDER_KIND_ORDER.map((kind) => ({
    kind,
    titleKey: modelsConfigProviderKindTitle(kind),
    rows: rows[kind].sort(byModelsConfigRowName),
  }));
}

function matchedModels(row: ModelsConfigProviderRow, needle: string): string[] {
  return row.models
    .filter((model) => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle))
    .map((model) => model.name);
}

export function filterModelsConfigProviderSections(
  sections: readonly ModelsConfigProviderSection[],
  query: string,
): ModelsConfigProviderSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return sections.filter((section) => section.rows.length > 0);
  }
  return sections.flatMap((section) => {
    const rows = section.rows.flatMap((row) => {
      const matches = matchedModels(row, needle);
      const providerMatches =
        row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
      if (!providerMatches && matches.length === 0) return [];
      return [{ ...row, matchedModels: matches }];
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}
