/** Epoch ms of local midnight for a calendar day. */
function startOfLocalDayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * How many whole local calendar days back `modified` sits, relative to
 * `now`: 0 = today, 1 = yesterday, … `null` when the timestamp is
 * unparseable.
 *
 * Calendar days (not 24h windows) so a session touched at 00:05 reads as
 * "today". Future timestamps (clock skew) clamp to 0.
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
