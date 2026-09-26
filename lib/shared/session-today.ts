/**
 * "Today's sessions" domain rules — shared by the client (which turns "now"
 * into the local calendar-day boundary it sends to `/api/sessions`) and the
 * server (which decides which rows fall inside that window).
 *
 * Pure module: no fs/path/Node APIs, safe on both sides of the boundary.
 */

/** Epoch ms of local midnight for the calendar day containing `now`. */
export function startOfLocalDayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Parse the `modifiedSince` query parameter. Returns a finite epoch-ms lower
 * bound, or `null` when the parameter is absent / blank / unparseable — in
 * which case callers apply no bound (backward compatible with every existing
 * `/api/sessions` caller).
 */
export function parseModifiedSince(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Structural shape carrying a session's last-activity timestamp. */
interface SessionTimestamp {
  modified: string;
}

/**
 * Whether a session's last activity (`modified`) falls at or after `sinceMs`.
 * The lower bound is inclusive; an unparseable timestamp never qualifies.
 *
 * Deliberately lower-bound only: the "today" window is [local midnight, +∞).
 * An upper bound of `now` would race with any session modified between the
 * client computing the boundary and the server answering the query, and a
 * future mtime is clock skew, not a different day.
 */
export function isSessionActiveSince(session: SessionTimestamp, sinceMs: number): boolean {
  const t = Date.parse(session.modified);
  return Number.isFinite(t) && t >= sinceMs;
}
