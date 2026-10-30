export const PROCESS_FOLD_PAGE = 5;

export const PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX = 600;

export type ProcessFoldState =
  | { readonly kind: "collapsed" }
  | { readonly kind: "partial"; readonly shown: number }
  | { readonly kind: "full" };

export type ProcessFoldEvent =
  | { readonly type: "row-click" }
  | { readonly type: "reveal-next" }
  | { readonly type: "reveal-all" }
  | { readonly type: "collapse-all" };

export function nextProcessFold(
  state: ProcessFoldState,
  event: ProcessFoldEvent,
  total: number,
): ProcessFoldState {
  const current = normalizeProcessFold(state, total);
  if (event.type === "collapse-all") {
    return current.kind === "collapsed" ? current : { kind: "collapsed" };
  }
  if (total <= 0) return current;

  switch (event.type) {
    case "row-click":
      return current.kind !== "collapsed" ? { kind: "collapsed" } : revealNextPage(current, total);
    case "reveal-next":
      return revealNextPage(current, total);
    case "reveal-all":
      return current.kind === "full" ? current : { kind: "full" };
  }
}

function revealNextPage(current: ProcessFoldState, total: number): ProcessFoldState {
  if (current.kind === "full") return current;
  const shown = current.kind === "partial" ? current.shown : 0;
  return total - shown <= PROCESS_FOLD_PAGE
    ? { kind: "full" }
    : { kind: "partial", shown: shown + PROCESS_FOLD_PAGE };
}

export interface ProcessFoldWindow {
  start: number;
  end: number;
  shown: number;
  isFraction: boolean;
}

export function processFoldWindow(state: ProcessFoldState, total: number): ProcessFoldWindow {
  const current = normalizeProcessFold(state, total);
  if (current.kind === "collapsed") {
    return { start: 0, end: 0, shown: total, isFraction: false };
  }
  if (current.kind === "full") {
    return { start: 0, end: total, shown: total, isFraction: false };
  }
  return { start: total - current.shown, end: total, shown: current.shown, isFraction: true };
}

export function foldInsertsAbove(
  prev: ProcessFoldState,
  next: ProcessFoldState,
  total: number,
): boolean {
  const before = processFoldWindow(prev, total);
  const after = processFoldWindow(next, total);
  return before.end > before.start && after.end > after.start && after.start < before.start;
}

export interface FoldToolCallItem {
  readonly toolCalls: Readonly<Record<string, number>>;
}

export function summarizeFoldWindow(
  items: readonly FoldToolCallItem[],
  state: ProcessFoldState,
): Record<string, number> {
  const total = items.length;
  const current = normalizeProcessFold(state, total);
  const foldWindow = processFoldWindow(current, total);
  const visible = current.kind === "collapsed" ? items : items.slice(foldWindow.start, foldWindow.end);
  const counts: Record<string, number> = {};
  for (const item of visible) {
    for (const [name, count] of Object.entries(item.toolCalls)) {
      if (count <= 0) continue;
      counts[name] = (counts[name] ?? 0) + count;
    }
  }
  return counts;
}

export interface ProcessFoldAction {
  readonly type: "reveal-next" | "reveal-all";
  readonly count: number;
  readonly revealsRest: boolean;
}

export function processFoldActions(
  state: ProcessFoldState,
  total: number,
): ProcessFoldAction[] {
  const current = normalizeProcessFold(state, total);
  if (total <= 0 || current.kind === "full") return [];

  const shown = current.kind === "partial" ? current.shown : 0;
  const remaining = total - shown;
  if (current.kind === "collapsed" && total <= PROCESS_FOLD_PAGE) {
    return [{ type: "reveal-all", count: total, revealsRest: true }];
  }
  if (current.kind === "partial" && remaining <= PROCESS_FOLD_PAGE) {
    return [{ type: "reveal-next", count: remaining, revealsRest: true }];
  }
  return [
    { type: "reveal-next", count: Math.min(PROCESS_FOLD_PAGE, remaining), revealsRest: false },
    { type: "reveal-all", count: remaining, revealsRest: true },
  ];
}

export function shouldAnimateFoldGrowth(
  prev: ProcessFoldState,
  next: ProcessFoldState,
  growthPx: number,
): boolean {
  return (
    prev.kind === "collapsed" &&
    next.kind !== "collapsed" &&
    growthPx <= PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX
  );
}

function normalizeProcessFold(state: ProcessFoldState, total: number): ProcessFoldState {
  if (total <= 0) return state.kind === "collapsed" ? state : { kind: "collapsed" };
  if (state.kind !== "partial") return state;
  if (state.shown <= 0) return { kind: "collapsed" };
  if (state.shown >= total) return { kind: "full" };
  return state;
}
