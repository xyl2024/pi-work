/**
 * Per-cwd draft buckets for the MCP panel view.
 *
 * The panel always shows the working directory of the selected session, but a
 * draft must not vanish just because the user glanced at another session. The
 * compromise (ADR-0018) is to bucket drafts by cwd: leaving a cwd keeps its
 * bucket, returning to it restores the draft untouched, and the next visit
 * shows that snapshot immediately while a background reconcile checks the disk.
 * The map survives a cwd switch; only closing the panel tab releases it.
 *
 * This module is the pure half of that rule. `lib/client/mcp-store.ts` holds the
 * bucket map and does the request / subscription wiring; the decisions live here
 * so they can be driven from `tests/unit` without a browser:
 *
 *   • `hasDirtyMcpBucket` — the one "any cwd has unsaved changes" predicate the
 *     right-bar badge and the close guard both read (same source of truth).
 *   • `isMcpBucketVerifying` / `shouldApplyMcpSnapshot` — the background
 *     reconcile's two questions: show "checking", and may the fresh read land.
 *   • `selectMcpBucket` / `withMcpBucket` / `releaseMcpBuckets` — the rest.
 */

import type { McpDraft } from "./mcp-draft";
import type { McpPanelData } from "./mcp-panel";
import type { McpPage } from "./mcp-pages";

/** Everything the panel keeps alive for one working directory. */
export interface McpDraftBucket {
  cwd: string;
  /** The files/vs. entries as they were read — the save baseline. */
  data: McpPanelData;
  /** The editable copy the panel renders. */
  draft: McpDraft;
  /** The page stack for this cwd (kept across a tab switch). */
  pages: McpPage[];
  /** The draft differs from `data` (i.e. a save would write something). */
  dirty: boolean;
  /**
   * The snapshot has been checked against disk since it was placed here. False
   * while a background reconcile is in flight — the panel shows the snapshot
   * with a subtle "checking" indicator instead of blocking.
   */
  verified: boolean;
}

/** All live buckets, keyed by cwd. */
export type McpDraftBuckets = Readonly<Record<string, McpDraftBucket>>;

/** Put one bucket in place, replacing the cwd's previous entry. */
export function withMcpBucket(
  buckets: McpDraftBuckets,
  bucket: McpDraftBucket,
): McpDraftBuckets {
  return { ...buckets, [bucket.cwd]: bucket };
}

/** Drop every bucket — the panel tab closed, so nothing is preserved. */
export function releaseMcpBuckets(): McpDraftBuckets {
  return {};
}

/** The "unsaved changes" predicate: true when any cwd holds a dirty draft. */
export function hasDirtyMcpBucket(buckets: McpDraftBuckets): boolean {
  return Object.values(buckets).some((bucket) => bucket.dirty);
}

/** Read one cwd's bucket, or null when it has none. */
export function selectMcpBucket(
  buckets: McpDraftBuckets,
  cwd: string | null,
): McpDraftBucket | null {
  return cwd === null ? null : buckets[cwd] ?? null;
}

/**
 * Whether the "checking the disk" indicator belongs on screen: a snapshot is
 * held but the background reconcile has not finished yet.
 */
export function isMcpBucketVerifying(bucket: McpDraftBucket | null): boolean {
  return bucket !== null && !bucket.verified;
}

/**
 * Whether a freshly read snapshot may replace the bucket on screen. A dirty
 * draft wins: the user's edits are never overwritten by a reconcile that
 * started before them.
 */
export function shouldApplyMcpSnapshot(bucket: McpDraftBucket | null): boolean {
  return bucket === null || !bucket.dirty;
}

/** The same bucket, with its snapshot marked as reconciled (or not). */
export function withMcpBucketVerified(
  buckets: McpDraftBuckets,
  cwd: string,
  verified: boolean,
): McpDraftBuckets {
  const bucket = buckets[cwd];
  if (!bucket || bucket.verified === verified) return buckets;
  return withMcpBucket(buckets, { ...bucket, verified });
}
