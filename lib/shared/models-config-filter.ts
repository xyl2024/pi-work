import type { ApiKeyProvider, OAuthProvider, ProviderEntry } from "./models-config";

export type ModelsConfigProviderKind = "subscription" | "apiKey" | "custom";

export interface ModelsConfigProviderRow {
  id: string;
  name: string;
  kind: ModelsConfigProviderKind;
  modelCount: number;
}

export function modelsConfigProviderRows(input: {
  oauthProviders: readonly OAuthProvider[];
  apiKeyProviders: readonly ApiKeyProvider[];
  providers: Record<string, ProviderEntry>;
}): ModelsConfigProviderRow[] {
  const subscriptions = input.oauthProviders
    .filter((provider) => provider.loggedIn)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: "subscription" as const,
      modelCount: 0,
    }));
  const apiKeys = input.apiKeyProviders
    .filter((provider) => provider.configured)
    .map((provider) => ({
      id: provider.id,
      name: provider.displayName,
      kind: "apiKey" as const,
      modelCount: provider.modelCount,
    }));
  const custom = Object.entries(input.providers).map(([name, provider]) => ({
    id: name,
    name,
    kind: "custom" as const,
    modelCount: provider.models?.length ?? 0,
  }));
  return [...subscriptions, ...apiKeys, ...custom];
}

export function filterModelsConfigProviderRows(
  rows: readonly ModelsConfigProviderRow[],
  query: string,
): ModelsConfigProviderRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
  );
}
