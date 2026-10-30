import type { HourBucket, SummaryBucket } from "../shared/token-audit-types";

export type { HourBucket };

export function parseLocalHourKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(key);
  if (!m) return 0;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, 0, 0).getTime();
}

export type { SummaryBucket };
