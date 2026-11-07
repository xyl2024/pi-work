export const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type CostField = (typeof COST_FIELDS)[number];

export interface CostTierRow {
  tokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function formatThousands(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  return Math.round(value).toLocaleString("en-US");
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function costTierRows(tiers: unknown): CostTierRow[] {
  if (!Array.isArray(tiers)) return [];
  const rows: CostTierRow[] = [];
  for (const tier of tiers) {
    if (typeof tier !== "object" || tier === null || Array.isArray(tier)) continue;
    const entry = tier as Record<string, unknown>;
    if (typeof entry.inputTokensAbove !== "number" || !Number.isFinite(entry.inputTokensAbove)) continue;
    rows.push({
      tokensAbove: entry.inputTokensAbove,
      input: finite(entry.input),
      output: finite(entry.output),
      cacheRead: finite(entry.cacheRead),
      cacheWrite: finite(entry.cacheWrite),
    });
  }
  return rows.sort((a, b) => a.tokensAbove - b.tokensAbove);
}
