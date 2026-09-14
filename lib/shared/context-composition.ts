// ============================================================================
// Context composition (pure)
//
// "What is this context window made of, and how much does each part take?"
//
// The provider only ever reports a *total* (pi's `getContextUsage().tokens`,
// which comes from `usage.input/output/cacheRead/cacheWrite`). Every provider
// is like that — none of them break the prompt down by source. So the split is
// inherently local, and the contract the UI publishes is: **the total is exact
// (the model said so), the split is an estimate (we computed it)**. That is why
// the total carries no decoration and every classified number is prefixed with
// `≈`. See ADR-0005 for the rejected alternatives (`chars/4`, per-provider
// encodings, the provider count_tokens endpoints) and why there is deliberately
// no "protocol overhead / unclassified" row.
//
// The arithmetic is a **single global normalization** (ADR-0005): count every
// leaf locally, then scale all of them by one factor `k = total / Σ local` so
// that `Σ leaves === total` holds *by construction* — never negative, and no
// "who owns the residual" second rule. A caller that only classifies one bucket
// therefore gets that bucket holding the whole total; that is the honest
// consequence of not having classified the rest yet, not a bug.
//
// Token counting is **injected** (`countTokens`), never imported: the real
// tokenizer is a 2.4MB server-only BPE (see `lib/server/context-tokenizer.ts`),
// and injection is what keeps this module testable without any server
// dependency — the same reason `tool-call-display` takes `resolveReadPath` as a
// parameter. Like `panelTabs` / `chat-timeline` / `tool-call-display`
// (ADR-0002 / ADR-0003) this module may not import React, DOM, i18n, a client
// hook, or anything from `lib/server`.
// ============================================================================

/** The four top-level sources of a context window, per CONTEXT.md
 *  （上下文构成）. `skills` is carved out of the system prompt, so
 *  `system-prompt + skills === countTokens(whole system prompt)`. */
export const CONTEXT_BUCKET_IDS = [
  "system-prompt",
  "system-tools",
  "skills",
  "messages",
] as const;

export type ContextBucketId = (typeof CONTEXT_BUCKET_IDS)[number];

/** One locally-counted unit of context. `text` is the raw content whose token
 *  count forms this leaf's local count. */
export interface ContextCompositionLeaf {
  /** Stable id used by the UI (jump targets, expand state) and by tests. */
  id: string;
  text: string;
}

/** A leaf after counting + anchoring. `tokens` / `percent` are `null` when no
 *  usable provider anchor exists — the caller then shows the local count
 *  without a percentage rather than a wrong one. */
export interface ContextCompositionLeafCount {
  id: string;
  /** Raw local count before normalization. Never negative. */
  localTokens: number;
  /** Local count scaled to the provider total; `null` without an anchor. */
  tokens: number | null;
  /** Share of the provider total in [0, 100]; `null` without an anchor. */
  percent: number | null;
}

/** One top-level bucket: its leaves plus the same three numbers summed. */
export interface ContextCompositionBucket {
  id: ContextBucketId;
  leaves: ContextCompositionLeafCount[];
  localTokens: number;
  tokens: number | null;
  percent: number | null;
}

export interface ContextComposition {
  buckets: ContextCompositionBucket[];
  /** Σ of every leaf's local count — the normalization denominator. */
  localTotal: number;
  /** The provider-reported total this composition was anchored to. */
  anchoredTotalTokens: number | null;
}

export interface ContextCompositionInput {
  /** Buckets in display order, each with the leaves that belong to it. */
  buckets: Array<{ id: ContextBucketId; leaves: ContextCompositionLeaf[] }>;
  /** Provider-anchored exact total (pi's `getContextUsage().tokens`).
   *  `null` while the provider hasn't reported usage yet (no assistant reply,
   *  or right after a compaction). */
  anchoredTotalTokens: number | null;
  /** The injected tokenizer — the only entry point to token counting. */
  countTokens: (text: string) => number;
}

/** A usable anchor is a positive, finite number. Anything else (missing,
 *  zero, negative, NaN) degrades the whole composition to unanchored. */
function usableAnchor(anchoredTotalTokens: number | null | undefined): number | null {
  if (typeof anchoredTotalTokens !== "number" || !Number.isFinite(anchoredTotalTokens)) return null;
  return anchoredTotalTokens > 0 ? anchoredTotalTokens : null;
}

/** Distribute `anchoredTotal` across the local counts proportionally, using
 *  the largest-remainder method so the parts sum to `anchoredTotal` exactly
 *  (plain rounding can land one token off, which the UI would show as "the
 *  four buckets don't add up"). */
function allocateTokens(localTokens: number[], anchoredTotal: number): number[] {
  const localTotal = localTokens.reduce((sum, value) => sum + value, 0);
  if (localTotal <= 0 || anchoredTotal <= 0) return localTokens.map(() => 0);
  const exact = localTokens.map((value) => (value * anchoredTotal) / localTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remaining = anchoredTotal - allocated.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remaining > 0 && i < byFraction.length; i++) {
    allocated[byFraction[i].index] += 1;
    remaining -= 1;
  }
  return allocated;
}

/**
 * Count a context window's leaves locally and anchor them to the provider's
 * exact total. Pure: everything it needs (the leaf texts and the counting
 * function) comes in as arguments.
 *
 * Invariants, valid for every input:
 *  - `Σ buckets.localTokens === localTotal`;
 *  - with an anchor, `Σ leaves.tokens === anchoredTotalTokens` and
 *    `Σ leaves.percent === 100` (allocation is exact, not rounded);
 *  - `localTokens >= 0` and `tokens >= 0`; no `NaN` / `Infinity`, ever.
 */
export function computeContextComposition(input: ContextCompositionInput): ContextComposition {
  const anchoredTotalTokens = usableAnchor(input.anchoredTotalTokens);

  const counted = input.buckets.map((bucket) => {
    const leaves = bucket.leaves.map((leaf) => {
      const raw = input.countTokens(leaf.text);
      const localTokens = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      return { id: leaf.id, localTokens };
    });
    return {
      id: bucket.id,
      leaves,
      localTokens: leaves.reduce((sum, leaf) => sum + leaf.localTokens, 0),
    };
  });

  const localTotal = counted.reduce((sum, bucket) => sum + bucket.localTokens, 0);

  if (anchoredTotalTokens === null) {
    return {
      buckets: counted.map((bucket) => ({
        ...bucket,
        leaves: bucket.leaves.map((leaf) => ({ ...leaf, tokens: null, percent: null })),
        tokens: null,
        percent: null,
      })),
      localTotal,
      anchoredTotalTokens: null,
    };
  }

  const allocated = allocateTokens(
    counted.flatMap((bucket) => bucket.leaves.map((leaf) => leaf.localTokens)),
    anchoredTotalTokens,
  );

  let cursor = 0;
  const buckets = counted.map((bucket) => {
    const leaves = bucket.leaves.map((leaf) => {
      const tokens = allocated[cursor++];
      return { ...leaf, tokens, percent: (tokens / anchoredTotalTokens) * 100 };
    });
    const tokens = leaves.reduce((sum, leaf) => sum + (leaf.tokens ?? 0), 0);
    return {
      ...bucket,
      leaves,
      tokens,
      percent: (tokens / anchoredTotalTokens) * 100,
    };
  });

  return { buckets, localTotal, anchoredTotalTokens };
}

/** One-decimal percentage for the ring tooltip, dropping a trailing `.0` so a
 *  solo bucket reads as `100%` rather than `100.0%`. */
export function formatCompositionPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}
