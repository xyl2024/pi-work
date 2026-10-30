export interface SessionDateRange {
  from: number;
  before: number;
}

export function localSessionDay(now: Date): SessionDateRange {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    before: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(),
  };
}

export function matchesSessionDate(modified: string, range: SessionDateRange | null): boolean {
  if (!range) return true;
  const time = Date.parse(modified);
  return time >= range.from && time < range.before;
}

export function parseSessionDateRange(params: URLSearchParams, prefix = "modified"): SessionDateRange | null | undefined {
  const from = params.get(`${prefix}From`);
  const before = params.get(`${prefix}Before`);
  if (from === null && before === null) return null;
  if (!from || !before) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(before);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return undefined;
  return { from: start, before: end };
}

export function appendSessionDateRange(params: URLSearchParams, range: SessionDateRange | null, prefix = "modified"): void {
  if (!range) return;
  params.set(`${prefix}From`, new Date(range.from).toISOString());
  params.set(`${prefix}Before`, new Date(range.before).toISOString());
}
