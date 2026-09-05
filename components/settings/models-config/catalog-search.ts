// Full-text search over the flattened runtime model catalog. Used by the
// "add custom model" name-search step. Kept free of extensionless value
// imports so it can be exercised by `node --experimental-strip-types`.

import type { RuntimeModelInfo } from "./types";

export type CatalogModelEntry = { model: RuntimeModelInfo; providerName: string };

/** Full-text filter over provider name and the model's entire metadata. */
export function filterCatalogModels(entries: CatalogModelEntry[], query: string): CatalogModelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(({ model, providerName }) =>
    `${providerName} ${model.provider} ${JSON.stringify(model)}`.toLowerCase().includes(q),
  );
}
