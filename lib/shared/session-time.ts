function startOfLocalDayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function sessionDayDiff(modified: string, now: Date): number | null {
  const t = Date.parse(modified);
  if (!Number.isFinite(t)) return null;
  const startOfModifiedDay = startOfLocalDayMs(new Date(t));
  const days = Math.round((startOfLocalDayMs(now) - startOfModifiedDay) / 86_400_000);
  return days < 0 ? 0 : days;
}

export type SessionTimeLabel =
  | { kind: "just-now" }
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number }
  | { kind: "relative"; days: number }
  | { kind: "date"; text: string };

export const SESSION_RELATIVE_DAY_MAX = 3;

export function sessionTimeLabel(modified: string, now: Date): SessionTimeLabel | null {
  const days = sessionDayDiff(modified, now);
  if (days === null) return null;
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(modified));
  if (elapsedMs < 60_000) return { kind: "just-now" };
  if (elapsedMs < 3_600_000) {
    return { kind: "minutes", minutes: Math.floor(elapsedMs / 60_000) };
  }
  if (elapsedMs < 86_400_000) {
    return { kind: "hours", hours: Math.floor(elapsedMs / 3_600_000) };
  }
  if (days <= SESSION_RELATIVE_DAY_MAX) return { kind: "relative", days };
  const d = new Date(Date.parse(modified));
  const pad = (n: number) => String(n).padStart(2, "0");
  return { kind: "date", text: `${pad(d.getMonth() + 1)}.${pad(d.getDate())}` };
}
