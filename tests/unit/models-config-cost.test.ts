import { describe, expect, it } from "vitest";
import { formatThousands, costTierRows } from "@/lib/shared/models-config-cost";

describe("formatThousands", () => {
  it("groups digits of whole numbers", () => {
    expect(formatThousands(128000)).toBe("128,000");
    expect(formatThousands(1_000_000)).toBe("1,000,000");
    expect(formatThousands(999)).toBe("999");
    expect(formatThousands(0)).toBe("0");
  });

  it("returns an empty string for unset or invalid values", () => {
    expect(formatThousands(undefined)).toBe("");
    expect(formatThousands(null)).toBe("");
    expect(formatThousands(Number.NaN)).toBe("");
    expect(formatThousands(-1)).toBe("");
  });
});

describe("costTierRows", () => {
  it("keeps valid tiers sorted by threshold", () => {
    const rows = costTierRows([
      { inputTokensAbove: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
      { inputTokensAbove: 100_000, input: 3, output: 15 },
    ]);
    expect(rows).toEqual([
      { tokensAbove: 100_000, input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      { tokensAbove: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
    ]);
  });

  it("drops entries without a numeric threshold", () => {
    expect(costTierRows([{ input: 1 }, "nope", null, { inputTokensAbove: "1000", input: 1 }])).toEqual([]);
  });

  it("returns an empty list for unset cost tiers", () => {
    expect(costTierRows(undefined)).toEqual([]);
    expect(costTierRows({})).toEqual([]);
  });
});
