/**
 * Compact "Xm / Xh / Xd ago" formatter for feed/article timestamps.
 *
 * Returns `fallback` when the timestamp is null (e.g. never-fetched feeds),
 * otherwise a short relative string capped at 7 days — beyond that we
 * surface a real locale date so the user sees something meaningful
 * instead of "20d".
 */
export function relativeTime(ts: number | null, fallback: string): string {
  if (!ts) return fallback;
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ts).toLocaleDateString();
}
