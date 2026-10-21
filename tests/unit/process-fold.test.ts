import { describe, expect, it } from "vitest";
import {
  PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX,
  PROCESS_FOLD_PAGE,
  foldInsertsAbove,
  nextProcessFold,
  processFoldActions,
  processFoldWindow,
  shouldAnimateFoldGrowth,
  summarizeFoldWindow,
  type ProcessFoldState,
} from "@/lib/shared/process-fold";

const collapsed: ProcessFoldState = { kind: "collapsed" };
const full: ProcessFoldState = { kind: "full" };
const partial = (shown: number): ProcessFoldState => ({ kind: "partial", shown });

describe("PROCESS_FOLD_PAGE", () => {
  it("is the product page size", () => {
    expect(PROCESS_FOLD_PAGE).toBe(5);
  });
});

describe("shouldAnimateFoldGrowth", () => {
  it("animates a short first expansion", () => {
    expect(shouldAnimateFoldGrowth(collapsed, partial(5), 0)).toBe(true);
    expect(shouldAnimateFoldGrowth(collapsed, partial(5), PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX)).toBe(true);
  });

  it("skips the animation above the threshold", () => {
    expect(shouldAnimateFoldGrowth(collapsed, full, PROCESS_FOLD_MAX_ANIMATED_GROWTH_PX + 1)).toBe(false);
  });

  it("never animates a prepended slice", () => {
    expect(shouldAnimateFoldGrowth(partial(5), partial(10), 100)).toBe(false);
    expect(shouldAnimateFoldGrowth(full, collapsed, 100)).toBe(false);
  });
});

describe("nextProcessFold row-click", () => {
  it("stays collapsed when the turn has no process rows", () => {
    expect(nextProcessFold(collapsed, { type: "row-click" }, 0)).toEqual(collapsed);
  });

  it("expands everything when the turn fits in one page", () => {
    for (const total of [1, 4, 5]) {
      expect(nextProcessFold(collapsed, { type: "row-click" }, total)).toEqual(full);
    }
  });

  it("expands the last page when the turn is longer than one page", () => {
    for (const total of [6, 10, 11, 34]) {
      expect(nextProcessFold(collapsed, { type: "row-click" }, total)).toEqual(partial(PROCESS_FOLD_PAGE));
    }
  });

  it("collapses a partial or fully expanded turn", () => {
    expect(nextProcessFold(partial(10), { type: "row-click" }, 34)).toEqual(collapsed);
    expect(nextProcessFold(full, { type: "row-click" }, 34)).toEqual(collapsed);
  });
});

describe("nextProcessFold reveal-next", () => {
  it("behaves like a row click from collapsed", () => {
    expect(nextProcessFold(collapsed, { type: "reveal-next" }, 34)).toEqual(partial(5));
    expect(nextProcessFold(collapsed, { type: "reveal-next" }, 4)).toEqual(full);
  });

  it("adds one page while more than a page remains", () => {
    expect(nextProcessFold(partial(5), { type: "reveal-next" }, 34)).toEqual(partial(10));
    expect(nextProcessFold(partial(10), { type: "reveal-next" }, 16)).toEqual(partial(15));
  });

  it("finishes the turn when exactly one page remains", () => {
    expect(nextProcessFold(partial(5), { type: "reveal-next" }, 10)).toEqual(full);
    expect(nextProcessFold(partial(10), { type: "reveal-next" }, 15)).toEqual(full);
  });

  it("finishes the turn when less than a page remains", () => {
    expect(nextProcessFold(partial(5), { type: "reveal-next" }, 9)).toEqual(full);
    expect(nextProcessFold(partial(5), { type: "reveal-next" }, 6)).toEqual(full);
  });

  it("does nothing when everything is already shown", () => {
    expect(nextProcessFold(full, { type: "reveal-next" }, 34)).toBe(full);
  });
});

describe("nextProcessFold reveal-all", () => {
  it("expands every remaining row from collapsed or partial", () => {
    expect(nextProcessFold(collapsed, { type: "reveal-all" }, 34)).toEqual(full);
    expect(nextProcessFold(partial(10), { type: "reveal-all" }, 34)).toEqual(full);
  });

  it("does nothing when already full", () => {
    expect(nextProcessFold(full, { type: "reveal-all" }, 34)).toBe(full);
  });
});

describe("nextProcessFold collapse-all", () => {
  it("returns every state to collapsed", () => {
    expect(nextProcessFold(collapsed, { type: "collapse-all" }, 34)).toEqual(collapsed);
    expect(nextProcessFold(partial(10), { type: "collapse-all" }, 34)).toEqual(collapsed);
    expect(nextProcessFold(full, { type: "collapse-all" }, 34)).toEqual(collapsed);
  });
});

describe("nextProcessFold defensive normalization", () => {
  it("treats an empty turn as collapsed for every event", () => {
    for (const event of [
      { type: "row-click" },
      { type: "reveal-next" },
      { type: "reveal-all" },
      { type: "collapse-all" },
    ] as const) {
      expect(nextProcessFold(partial(5), event, 0)).toEqual(collapsed);
    }
  });

  it("returns the same collapsed object for an empty turn", () => {
    expect(nextProcessFold(collapsed, { type: "row-click" }, 0)).toBe(collapsed);
    expect(nextProcessFold(collapsed, { type: "reveal-all" }, 0)).toBe(collapsed);
  });

  it("treats a partial state covering the whole turn as full", () => {
    expect(nextProcessFold(partial(5), { type: "reveal-next" }, 3)).toEqual(full);
    expect(processFoldWindow(partial(5), 3)).toMatchObject({
      start: 0,
      end: 3,
      shown: 3,
      isFraction: false,
    });
  });
});

describe("processFoldWindow", () => {
  it("renders no rows and reports the turn total when collapsed", () => {
    expect(processFoldWindow(collapsed, 34)).toEqual({
      start: 0,
      end: 0,
      shown: 34,
      isFraction: false,
    });
  });

  it("renders the last N rows and reports the fraction when partial", () => {
    expect(processFoldWindow(partial(5), 34)).toEqual({
      start: 29,
      end: 34,
      shown: 5,
      isFraction: true,
    });
  });

  it("renders every row and reports the turn total when full", () => {
    expect(processFoldWindow(full, 34)).toEqual({
      start: 0,
      end: 34,
      shown: 34,
      isFraction: false,
    });
  });

  it("normalizes an empty turn", () => {
    expect(processFoldWindow(partial(5), 0)).toEqual({
      start: 0,
      end: 0,
      shown: 0,
      isFraction: false,
    });
  });

  it("normalizes a partial state larger than the turn to the whole turn", () => {
    expect(processFoldWindow(partial(5), 3)).toEqual({
      start: 0,
      end: 3,
      shown: 3,
      isFraction: false,
    });
  });
});

describe("foldInsertsAbove", () => {
  it("is false for the first expansion (content grows below the row)", () => {
    expect(foldInsertsAbove(collapsed, partial(5), 34)).toBe(false);
    expect(foldInsertsAbove(collapsed, full, 34)).toBe(false);
  });

  it("is true when more rows are prepended to already-rendered content", () => {
    expect(foldInsertsAbove(partial(5), partial(10), 34)).toBe(true);
    expect(foldInsertsAbove(partial(5), full, 34)).toBe(true);
  });

  it("is false when content is removed", () => {
    expect(foldInsertsAbove(partial(5), collapsed, 34)).toBe(false);
    expect(foldInsertsAbove(full, collapsed, 34)).toBe(false);
  });

  it("is false when the window does not change", () => {
    expect(foldInsertsAbove(partial(5), partial(5), 34)).toBe(false);
    expect(foldInsertsAbove(full, full, 34)).toBe(false);
  });
});

describe("summarizeFoldWindow", () => {
  const items: { toolCalls: Record<string, number> }[] = [
    { toolCalls: { read: 1 } },
    { toolCalls: {} },
    { toolCalls: { bash: 2 } },
    { toolCalls: { read: 1, bash: 1 } },
    { toolCalls: { edit: 1 } },
    { toolCalls: {} },
    { toolCalls: { bash: 3 } },
    { toolCalls: { read: 2 } },
    { toolCalls: { bash: 1 } },
    { toolCalls: { read: 1 } },
  ];

  it("sums the visible window when partial", () => {
    expect(summarizeFoldWindow(items, partial(5))).toEqual({ bash: 4, read: 3 });
  });

  it("sums the whole turn when collapsed", () => {
    expect(summarizeFoldWindow(items, collapsed)).toEqual({ bash: 7, read: 5, edit: 1 });
  });

  it("sums the whole turn when full", () => {
    expect(summarizeFoldWindow(items, full)).toEqual({ bash: 7, read: 5, edit: 1 });
  });

  it("returns no counts for an empty turn", () => {
    expect(summarizeFoldWindow([], collapsed)).toEqual({});
    expect(summarizeFoldWindow([], partial(5))).toEqual({});
  });

  it("falls back to the whole turn for a normalized-collapsed state", () => {
    expect(summarizeFoldWindow(items, partial(0))).toEqual({ bash: 7, read: 5, edit: 1 });
  });
});

describe("processFoldActions", () => {
  it("offers only expand-all when the turn fits in one page", () => {
    expect(processFoldActions(collapsed, 4)).toEqual([
      { type: "reveal-all", count: 4, revealsRest: true },
    ]);
  });

  it("offers last page plus expand-all when the turn is longer", () => {
    expect(processFoldActions(collapsed, 10)).toEqual([
      { type: "reveal-next", count: 5, revealsRest: false },
      { type: "reveal-all", count: 10, revealsRest: true },
    ]);
  });

  it("offers next page plus expand-all while more than a page remains", () => {
    expect(processFoldActions(partial(5), 12)).toEqual([
      { type: "reveal-next", count: 5, revealsRest: false },
      { type: "reveal-all", count: 7, revealsRest: true },
    ]);
  });

  it("offers only the remaining rows when they fit in one page", () => {
    expect(processFoldActions(partial(5), 10)).toEqual([
      { type: "reveal-next", count: 5, revealsRest: true },
    ]);
    expect(processFoldActions(partial(5), 8)).toEqual([
      { type: "reveal-next", count: 3, revealsRest: true },
    ]);
  });

  it("offers nothing when everything is shown", () => {
    expect(processFoldActions(full, 34)).toEqual([]);
    expect(processFoldActions(collapsed, 0)).toEqual([]);
  });
});
