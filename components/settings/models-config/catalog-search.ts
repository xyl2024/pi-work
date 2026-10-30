import type { RuntimeModelInfo } from "./types";

export type CatalogModelEntry = { model: RuntimeModelInfo; providerName: string };

export function filterCatalogModels(entries: CatalogModelEntry[], query: string): CatalogModelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(({ model, providerName }) =>
    `${providerName} ${model.provider} ${JSON.stringify(model)}`.toLowerCase().includes(q),
  );
}
