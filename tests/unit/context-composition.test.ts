import { describe, expect, it } from "vitest";
import {
  computeContextComposition,
  formatCompositionPercent,
  type ContextCompositionInput,
} from "@/lib/shared/context-composition";

// ── Fixtures ──
//
// `countTokens` is injected, so these tests can use a cheap deterministic
// fake. The real tokenizer is a server-only dynamic import (see
// `lib/server/context-tokenizer.ts`) and must never be reachable from here —
// that is the whole point of the injection.

/** One token per 4 characters, floored — enough to make the arithmetic
 *  checkable by hand without caring about real BPE ranks. */
const chars4 = (text: string) => Math.floor(text.length / 4);

function composition(input: Partial<ContextCompositionInput> & Pick<ContextCompositionInput, "buckets">) {
  return computeContextComposition({
    anchoredTotalTokens: input.anchoredTotalTokens ?? null,
    countTokens: input.countTokens ?? chars4,
    buckets: input.buckets,
  });
}

describe("computeContextComposition", () => {
  it("anchors a single bucket to the provider total (the #34 pin)", () => {
    const result = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x".repeat(400) }] }],
      anchoredTotalTokens: 42_000,
    });

    expect(result.localTotal).toBe(100);
    expect(result.anchoredTotalTokens).toBe(42_000);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].tokens).toBe(42_000);
    expect(result.buckets[0].percent).toBe(100);
  });

  it("splits four buckets so they sum to the exact total", () => {
    const result = composition({
      buckets: [
        { id: "system-prompt", leaves: [{ id: "base", text: "a".repeat(400) }] }, // 100
        { id: "system-tools", leaves: [{ id: "tools", text: "b".repeat(800) }] }, // 200
        { id: "skills", leaves: [{ id: "skills", text: "c".repeat(120) }] }, // 30
        { id: "messages", leaves: [{ id: "messages", text: "d".repeat(80) }] }, // 20
      ],
      anchoredTotalTokens: 700,
    });

    expect(result.localTotal).toBe(350);
    const tokens = result.buckets.map((bucket) => bucket.tokens ?? -1);
    expect(tokens).toEqual([200, 400, 60, 40]);
    expect(tokens.reduce((sum, value) => sum + value, 0)).toBe(700);
    const percents = result.buckets.map((bucket) => bucket.percent ?? -1);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
    expect(result.buckets.every((bucket) => bucket.percent !== null)).toBe(true);
  });

  it("keeps the anchor exact when proportionally rounding would drift", () => {
    // 3 equal leaves into 100 tokens: 33/33/34, never 33/33/33 (sum 99).
    const result = composition({
      buckets: [
        { id: "messages", leaves: [
          { id: "a", text: "a".repeat(40) },
          { id: "b", text: "b".repeat(40) },
          { id: "c", text: "c".repeat(40) },
        ] },
      ],
      anchoredTotalTokens: 100,
    });

    const tokens = result.buckets[0].leaves.map((leaf) => leaf.tokens);
    expect(tokens.reduce((sum: number, value) => sum + (value ?? 0), 0)).toBe(100);
    expect(new Set(tokens).size).toBeGreaterThan(1);
  });

  it("always sums a bucket from its leaves", () => {
    const result = composition({
      buckets: [
        { id: "system-prompt", leaves: [
          { id: "base", text: "a".repeat(400) },
          { id: "agents", text: "b".repeat(37) },
          { id: "docs", text: "c".repeat(3) },
        ] },
      ],
      anchoredTotalTokens: 1_000,
    });

    const bucket = result.buckets[0];
    expect(bucket.localTokens).toBe(
      bucket.leaves.reduce((sum, leaf) => sum + leaf.localTokens, 0),
    );
    expect(bucket.tokens).toBe(bucket.leaves.reduce((sum, leaf) => sum + (leaf.tokens ?? 0), 0));
  });

  it("handles normalization in both directions", () => {
    const up = composition({
      buckets: [{ id: "messages", leaves: [{ id: "m", text: "x".repeat(40) }] }],
      anchoredTotalTokens: 100, // local 10 → k = 10
    });
    const down = composition({
      buckets: [{ id: "messages", leaves: [{ id: "m", text: "x".repeat(4000) }] }],
      anchoredTotalTokens: 100, // local 1000 → k = 0.1
    });

    expect(up.buckets[0].tokens).toBe(100);
    expect(down.buckets[0].tokens).toBe(100);
    expect(down.buckets[0].leaves[0].localTokens).toBe(1000);
  });

  it("degrades to local-only numbers without an anchor", () => {
    const result = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x".repeat(400) }] }],
      anchoredTotalTokens: null,
    });

    expect(result.localTotal).toBe(100);
    expect(result.anchoredTotalTokens).toBeNull();
    expect(result.buckets[0].localTokens).toBe(100);
    expect(result.buckets[0].tokens).toBeNull();
    expect(result.buckets[0].percent).toBeNull();
    expect(result.buckets[0].leaves[0].tokens).toBeNull();
    expect(result.buckets[0].leaves[0].percent).toBeNull();
  });

  it("never produces NaN or Infinity for empty / zero-size inputs", () => {
    const empty = composition({ buckets: [], anchoredTotalTokens: 500 });
    const zeroTotal = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "" }] }],
      anchoredTotalTokens: 0,
    });
    const knownTextZeroAnchor = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x".repeat(400) }] }],
      anchoredTotalTokens: 0,
    });

    expect(empty.localTotal).toBe(0);
    expect(empty.buckets).toEqual([]);
    expect(zeroTotal.buckets[0]).toMatchObject({ localTokens: 0, tokens: null, percent: null });
    expect(knownTextZeroAnchor.buckets[0]).toMatchObject({ localTokens: 100, tokens: null, percent: null });
  });

  it("treats a non-finite anchor or count as unanchored / zero", () => {
    const result = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x".repeat(400) }] }],
      anchoredTotalTokens: Number.NaN,
      countTokens: () => Number.POSITIVE_INFINITY,
    });

    expect(result.anchoredTotalTokens).toBeNull();
    expect(result.buckets[0].localTokens).toBe(0);
    expect(result.buckets[0].tokens).toBeNull();
  });

  it("clamps a negative local count instead of propagating it", () => {
    const result = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x" }] }],
      anchoredTotalTokens: 10,
      countTokens: () => -5,
    });

    expect(result.localTotal).toBe(0);
    expect(result.buckets[0].localTokens).toBe(0);
  });

  it("covers a system prompt with no messages without inventing a percentage", () => {
    const result = composition({
      buckets: [{ id: "system-prompt", leaves: [{ id: "system-prompt", text: "x".repeat(400) }] }],
      anchoredTotalTokens: null,
    });

    const bucket = result.buckets[0];
    expect(bucket.tokens).toBeNull();
    expect(Number.isNaN(bucket.percent as number)).toBe(false);
  });
});

describe("formatCompositionPercent", () => {
  it("drops a trailing .0 and keeps one decimal otherwise", () => {
    expect(formatCompositionPercent(100)).toBe("100");
    expect(formatCompositionPercent(33.333)).toBe("33.3");
  });
});
