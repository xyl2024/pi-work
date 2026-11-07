import { catalogSearchResults } from "./catalog-search";
import type { ModelsJson, RuntimeCatalogProvider, RuntimeModelInfo } from "./models-config";

export type CatalogProviderSource = "static" | "dynamic";

const SOURCE_LABEL: Record<CatalogProviderSource, string> = {
  static: "Static catalog",
  dynamic: "Dynamic catalog",
};

export interface CatalogModelRow {
  key: string;
  model: RuntimeModelInfo;
  configured: boolean;
}

export interface CatalogProviderRow {
  id: string;
  name: string;
  baseUrl?: string;
  source: CatalogProviderSource;
  sourceLabel: string;
  configured: boolean;
  auth: { configured: boolean; label: string | null };
  modelCount: number;
  models: CatalogModelRow[];
}

export interface CatalogConfiguredKeys {
  providerIds: readonly string[];
  modelIds: readonly string[];
}

export function catalogConfiguredKeys(config: ModelsJson | undefined): CatalogConfiguredKeys {
  const providers = config?.providers ?? {};
  return {
    providerIds: Object.keys(providers),
    modelIds: Object.values(providers).flatMap((provider) => (provider.models ?? []).map((model) => model.id)),
  };
}

export function catalogSourceLabel(dynamic: boolean): string {
  return SOURCE_LABEL[dynamic ? "dynamic" : "static"];
}

function matches(value: string | undefined, needle: string): boolean {
  return (value ?? "").toLowerCase().includes(needle);
}

export function catalogProviderRows(input: {
  providers: readonly RuntimeCatalogProvider[];
  configured: CatalogConfiguredKeys;
}): CatalogProviderRow[] {
  const configuredProviders = new Set(input.configured.providerIds);
  const configuredModels = new Set(input.configured.modelIds);

  return input.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    source: provider.dynamic ? "dynamic" : "static",
    sourceLabel: catalogSourceLabel(provider.dynamic),
    configured: configuredProviders.has(provider.id),
    auth: { configured: provider.auth.configured, label: provider.auth.label ?? provider.auth.source ?? null },
    modelCount: provider.models.length,
    models: provider.models.map((model, index) => ({
      key: `${provider.id}:${index}:${model.id}`,
      model,
      configured: configuredModels.has(model.id),
    })),
  }));
}

export function filterCatalogProviderRows(
  rows: readonly CatalogProviderRow[],
  query: string,
): CatalogProviderRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];

  return rows.flatMap((row) => {
    const providerMatches =
      matches(row.id, needle) || matches(row.name, needle) || matches(row.baseUrl, needle);
    const hits = catalogSearchResults(
      row.models.map(({ model }) => ({ model, providerName: row.name })),
      needle,
      row.models.length,
    );
    const hitIds = new Set(hits.map((hit) => hit.model.id));
    const models = providerMatches ? row.models : row.models.filter((item) => hitIds.has(item.model.id));
    if (models.length === 0) return [];
    return [{ ...row, models, modelCount: models.length }];
  });
}
