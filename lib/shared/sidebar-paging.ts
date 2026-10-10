// ============================================================================
// Sidebar paging (pure)
//
// The "Sessions" section of the left sidebar pages in two places at once: the
// top-level list of workspace groups (cwd -> sessions), and, inside each
// expanded group, that cwd's session rows. Scroll-driven loading, the
// keep-the-depth-on-refresh rule and the "the container cannot scroll at all"
// fallback have a handful of decisions that are worth pinning down without a
// browser, so they live here.
//
//   - page sizes (workspace groups, per-group sessions) and the scroll
//     threshold that asks for the next page;
//   - how a newly fetched page merges into the rows already on screen (keyed
//     dedupe, order preserved) and how a selected session is injected when it
//     falls outside the loaded page;
//   - how a refresh keeps the depth the user has scrolled to instead of
//     snapping back to page one;
//   - when a scroll position means "fetch the next page", and when a page that
//     does not fill the scrollport should chain-load the next one anyway.
//
// The DOM side — the scroll container's measurements, the `scroll` listener,
// `requestAnimationFrame` — stays in `components/sessions/SessionSidebar.tsx`
// and `components/sessions/CwdSessionsModal.tsx`. Like `scroll-follow` and
// `panel-tabs` (ADR-0002/0003) this module may not import React, the DOM, a
// client hook, or anything from `lib/server`. `ScrollMetrics` and
// `distanceFromBottom()` are reused from `scroll-follow` rather than
// re-inventing a second metric type.
// ============================================================================

import { distanceFromBottom, type ScrollMetrics } from "./scroll-follow";

/** Page size for the top-level list of workspace groups. */
export const WORKSPACE_PAGE_SIZE = 5;

/** Sessions loaded per workspace group — first page and every later page. */
export const SESSION_PAGE_SIZE_GROUPED = 6;

/** How many times a page that cannot scroll may chain-load another. */
export const CHAIN_LOAD_LIMIT = 3;

/** Scroll prefetch threshold for the sidebar list. Larger than the modal's
 *  24px because the sidebar grows as collapsed groups expand. */
export const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 200;

/**
 * Append `incoming` to `prev`, dropping rows whose key is already present (or
 * repeated within `incoming`). Order is preserved. Returns `prev` unchanged —
 * same reference — when nothing new arrives, so a no-op append does not force
 * a repaint or move scroll position.
 */
export function mergePage<T>(prev: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(prev.map(keyOf));
  const additions: T[] = [];
  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(item);
  }
  return additions.length === 0 ? prev : [...prev, ...additions];
}

/**
 * Inject the active session into a group's loaded rows when it falls outside
 * them, at the tail of the first page (`pageSize` rows in). A session that is
 * already loaded — or a null active session — leaves the array untouched, so
 * the selected row keeps its place instead of being reordered on every render.
 */
export function insertActiveSession<T>(
  sessions: T[],
  active: T | null,
  pageSize: number,
  keyOf: (item: T) => string,
): T[] {
  if (!active) return sessions;
  const activeKey = keyOf(active);
  if (sessions.some((item) => keyOf(item) === activeKey)) return sessions;
  return [...sessions.slice(0, pageSize), active, ...sessions.slice(pageSize)];
}

/**
 * The request size a refresh should use: deep enough to keep every row the
 * user has already loaded, never smaller than one page. Pairs with the page's
 * own `nextCursor`, so paging resumes from the kept depth afterwards.
 */
export function refreshLimit(pageSize: number, loadedCount: number): number {
  return Math.max(pageSize, loadedCount);
}

/**
 * Whether a scroll event in the sidebar list should fetch the next page.
 * `metrics` is null before the scroll container exists; `rowCount` is the
 * number of top-level rows on screen (nothing to page from an empty list).
 */
export function decideLoadMoreOnScroll(input: {
  metrics: ScrollMetrics | null;
  thresholdPx: number;
  hasMore: boolean;
  loading: boolean;
  rowCount: number;
}): boolean {
  const { metrics, thresholdPx, hasMore, loading, rowCount } = input;
  if (!metrics) return false;
  if (!hasMore || loading) return false;
  if (rowCount === 0) return false;
  return distanceFromBottom(metrics) <= thresholdPx;
}

/**
 * Whether a scrollport has layout but nothing to scroll: the state that
 * defeats the scroll-driven path. A collapsed section measures zero height
 * and is excluded (`clientHeight > 0`), so it can never be mistaken for
 * "nothing to scroll".
 */
function cannotScroll(metrics: ScrollMetrics | null): boolean {
  return !!metrics && metrics.clientHeight > 0 && metrics.scrollHeight <= metrics.clientHeight;
}

/**
 * Whether a page that cannot scroll should chain-load the next one. Only runs
 * with layout (`clientHeight > 0`): a collapsed section measures zero height
 * and must never page in the background. Stops at `CHAIN_LOAD_LIMIT` chained
 * loads so a genuinely exhausted list surfaces the manual fallback instead of
 * looping. The cap lives here, not in the caller, so retuning it never means
 * touching a component.
 */
export function decideChainLoad(input: {
  metrics: ScrollMetrics | null;
  hasMore: boolean;
  loading: boolean;
  chainCount: number;
}): boolean {
  const { metrics, hasMore, loading, chainCount } = input;
  if (!cannotScroll(metrics)) return false;
  if (!hasMore || loading) return false;
  if (chainCount >= CHAIN_LOAD_LIMIT) return false;
  return true;
}

/**
 * After chaining is exhausted (or while a fetch is in flight), whether the
 * manual "load more projects" fallback row should show: the scroll path is
 * genuinely dead — the container has layout, cannot scroll, and there is
 * still more to load.
 */
export function showChainFallback(input: {
  metrics: ScrollMetrics | null;
  hasMore: boolean;
}): boolean {
  return input.hasMore && cannotScroll(input.metrics);
}
