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

/**
 * How many whole local calendar days back `modified` sits, relative to
 * `now`: 0 = today, 1 = yesterday, … `null` when the timestamp is
 * unparseable.
 *
 * Calendar days (not 24h windows) so a session touched at 00:05 reads as
 * "today" — the same boundary `startOfLocalDayMs` uses for the "today's
 * sessions" section. Future timestamps (clock skew) clamp to 0.
 */
export function sessionDayDiff(modified: string, now: Date): number | null {
  const t = Date.parse(modified);
  if (!Number.isFinite(t)) return null;
  const startOfModifiedDay = startOfLocalDayMs(new Date(t));
  const days = Math.round((startOfLocalDayMs(now) - startOfModifiedDay) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * Sidebar hover label for a session's last activity. Sessions modified
 * within the last few calendar days get a relative label (`days`), older
 * ones a `MM.DD` date — the caller maps `days` onto translated copy.
 */
export type SessionTimeLabel =
  | { kind: "relative"; days: number }
  | { kind: "date"; text: string };

/** Beyond this many calendar days back the label switches to a date. */
export const SESSION_RELATIVE_DAY_MAX = 3;

export function sessionTimeLabel(modified: string, now: Date): SessionTimeLabel | null {
  const days = sessionDayDiff(modified, now);
  if (days === null) return null;
  if (days <= SESSION_RELATIVE_DAY_MAX) return { kind: "relative", days };
  const d = new Date(Date.parse(modified));
  const pad = (n: number) => String(n).padStart(2, "0");
  return { kind: "date", text: `${pad(d.getMonth() + 1)}.${pad(d.getDate())}` };
}
