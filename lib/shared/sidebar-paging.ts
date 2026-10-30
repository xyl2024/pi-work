import { distanceFromBottom, type ScrollMetrics } from "./scroll-follow";

export const WORKSPACE_PAGE_SIZE = 5;

export const SESSION_PAGE_SIZE_GROUPED = 6;

export const CHAIN_LOAD_LIMIT = 3;

export const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 200;

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

export function refreshLimit(pageSize: number, loadedCount: number): number {
  return Math.max(pageSize, loadedCount);
}

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

function cannotScroll(metrics: ScrollMetrics | null): boolean {
  return !!metrics && metrics.clientHeight > 0 && metrics.scrollHeight <= metrics.clientHeight;
}

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

export function showChainFallback(input: {
  metrics: ScrollMetrics | null;
  hasMore: boolean;
}): boolean {
  return input.hasMore && cannotScroll(input.metrics);
}
