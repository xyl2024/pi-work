// ============================================================================
// Process fold (pure)
//
// A finished turn's middle ("what the agent did between the user's question and
// the final answer") is folded into one summary row. That row used to be
// all-or-nothing; this module owns the "expand by page" rules so the component
// only maps state to DOM and mouse events:
//
//   - the fold state machine (`collapsed` / `partial(n)` / `full`) and its four
//     events (row click, expand next page, expand all, the global collapse
//     broadcast);
//   - which slice of the turn's rows a state renders, and which numbers the
//     summary row shows (`34 messages` vs `10 / 34 messages`);
//   - whether that slice was inserted above already-rendered rows (the caller
//     then compensates `scrollTop` instead of letting the view jump);
//   - the tool-call tally for the visible window, falling back to the whole turn
//     while collapsed (the summary row is the only thing on screen then);
//   - the buttons the summary row offers.
//
// Like `chat-timeline`, `scroll-follow` and `panelTabs` (ADR-0002/0003) this
// module may not import React, the DOM, a client hook, or anything from
// `lib/server`.
// ============================================================================

/** Rows added by one "expand" step. A product parameter, not a performance
 *  one: it also decides the "a short turn expands fully on the first click"
 *  degeneration. */
export const PROCESS_FOLD_PAGE = 5;

/** A first expansion taller than this lands in one step instead of sliding:
 *  animating dozens of already-known rows carries no information and just
 *  makes the reader wait. */
export const PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX = 600;

/** collapsed = only the summary row; partial = the last N rows; full = all. */
export type ProcessFoldState =
  | { readonly kind: "collapsed" }
  | { readonly kind: "partial"; readonly shown: number }
  | { readonly kind: "full" };

export type ProcessFoldEvent =
  /** Click / Enter on the summary row. */
  | { readonly type: "row-click" }
  /** The "(expand) next N" button. */
  | { readonly type: "reveal-next" }
  /** The "expand all" button. */
  | { readonly type: "reveal-all" }
  /** The chat's global "collapse all" broadcast. */
  | { readonly type: "collapse-all" };

/** `total` is the number of process rows this turn can show. */
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
      // Unfolded (partial or full) means "collapse"; collapsed means "show the
      // nearest page". The amount of expansion is only ever changed by buttons.
      return current.kind !== "collapsed" ? { kind: "collapsed" } : revealNextPage(current, total);
    case "reveal-next":
      return revealNextPage(current, total);
    case "reveal-all":
      return current.kind === "full" ? current : { kind: "full" };
  }
}

/** Show one more page, or the whole turn when the remainder fits in one page. */
function revealNextPage(current: ProcessFoldState, total: number): ProcessFoldState {
  if (current.kind === "full") return current;
  const shown = current.kind === "partial" ? current.shown : 0;
  return total - shown <= PROCESS_FOLD_PAGE
    ? { kind: "full" }
    : { kind: "partial", shown: shown + PROCESS_FOLD_PAGE };
}

/** The rows a state asks for — `[start, end)` — plus the numbers the summary
 *  row prints. Collapsed renders nothing but still reports the turn total;
 *  a partial window reports the fraction form. Whether a *transition* inserts
 *  above already-rendered rows needs the previous state, so it is the separate
 *  `foldInsertsAbove(prev, next, total)` rather than a field here. */
export interface ProcessFoldWindow {
  start: number;
  end: number;
  /** The message number shown in the summary row (the turn total when
   *  collapsed, the visible count when partial). */
  shown: number;
  /** True when the summary row renders `{shown} / {total}` instead of
   *  `{shown}`. */
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

/**
 * Whether the next window prepends rows to content that is already on screen.
 * The caller compensates the scroll container's `scrollTop` in that case so the
 * row being read stays put; a first expansion grows below the summary row and
 * needs no compensation.
 */
export function foldInsertsAbove(
  prev: ProcessFoldState,
  next: ProcessFoldState,
  total: number,
): boolean {
  const before = processFoldWindow(prev, total);
  const after = processFoldWindow(next, total);
  return before.end > before.start && after.end > after.start && after.start < before.start;
}

/** The minimum shape `summarizeFoldWindow` needs from a process row. */
export interface FoldToolCallItem {
  readonly toolCalls: Readonly<Record<string, number>>;
}

/**
 * Tool-call counts by name for the rows currently on screen. While collapsed
 * there is no window, so the whole turn is summarised instead — the summary row
 * is then the turn's only information carrier. Empty windows produce `{}` (no
 * "0 tool calls" noise).
 */
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

/** One button the summary row offers. */
export interface ProcessFoldAction {
  readonly type: "reveal-next" | "reveal-all";
  /** How many rows this button adds. */
  readonly count: number;
  /** True when pressing it shows the rest of the turn, so the row renders the
   *  "expand the remaining N" wording and offers no separate "expand all". */
  readonly revealsRest: boolean;
}

/**
 * The buttons for a state. A short turn gets only "expand all" (two buttons
 * whose result is identical would be a pointless choice); a partial window
 * whose remainder fits in one page gets only "expand the remaining N".
 */
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

/** Whether a first expansion of `growthPx` should keep the height transition.
 *  Only a collapsed → expanded transition may animate: a prepended slice is
 *  compensated frame-by-frame instead. */
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

/** An empty turn has no fold group at all, and a partial window that covers the
 *  whole turn is indistinguishable from `full` — normalize both so every rule
 *  above only sees meaningful states. Returns the input object untouched when
 *  nothing needs normalizing (the reducer's "no change" contract). */
function normalizeProcessFold(state: ProcessFoldState, total: number): ProcessFoldState {
  if (total <= 0) return state.kind === "collapsed" ? state : { kind: "collapsed" };
  if (state.kind !== "partial") return state;
  if (state.shown <= 0) return { kind: "collapsed" };
  if (state.shown >= total) return { kind: "full" };
  return state;
}
