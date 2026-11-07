import type { RuntimeModelInfo } from "./models-config";

export const CATALOG_RESULT_LIMIT = 200;

export interface CatalogModelEntry {
  model: RuntimeModelInfo;
  providerName: string;
}

export function catalogSearchResults(
  entries: readonly CatalogModelEntry[],
  query: string,
  limit = CATALOG_RESULT_LIMIT,
): CatalogModelEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries.slice(0, limit);
  const hits: CatalogModelEntry[] = [];
  for (const entry of entries) {
    const haystack = `${entry.providerName} ${entry.model.provider} ${JSON.stringify(entry.model)}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    hits.push(entry);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function moveCatalogHighlight(current: number, length: number, step: number): number {
  if (length <= 0) return 0;
  const next = current + step;
  if (next < 0) return length - 1;
  if (next >= length) return 0;
  return next;
}
