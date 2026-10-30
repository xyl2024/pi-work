import { describe, expect, it } from "vitest";
import {
  CHAIN_LOAD_LIMIT,
  SESSION_PAGE_SIZE_GROUPED,
  SIDEBAR_LOAD_MORE_THRESHOLD_PX,
  WORKSPACE_PAGE_SIZE,
  decideChainLoad,
  decideLoadMoreOnScroll,
  insertActiveSession,
  mergePage,
  refreshLimit,
  showChainFallback,
} from "@/lib/shared/sidebar-paging";
import type { ScrollMetrics } from "@/lib/shared/scroll-follow";

interface Row {
  id: string;
  label?: string;
}

const keyOf = (row: Row) => row.id;

describe("page-size constants", () => {
  it("pages workspace groups by 5 and sessions by 6", () => {
    expect(WORKSPACE_PAGE_SIZE).toBe(5);
    expect(SESSION_PAGE_SIZE_GROUPED).toBe(6);
  });

  it("caps chained loads at 3 and prefetches 200px early", () => {
    expect(CHAIN_LOAD_LIMIT).toBe(3);
    expect(SIDEBAR_LOAD_MORE_THRESHOLD_PX).toBe(200);
  });
});

describe("mergePage", () => {
  it("appends unseen rows in order", () => {
    const prev = [{ id: "a" }, { id: "b" }];
    expect(mergePage(prev, [{ id: "c" }, { id: "d" }], keyOf)).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ]);
  });

  it("drops rows already present and duplicates inside the page", () => {
    const prev = [{ id: "a" }, { id: "b" }];
    expect(mergePage(prev, [{ id: "b" }, { id: "c" }, { id: "c" }], keyOf)).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  it("returns the original reference for an empty increment", () => {
    const prev = [{ id: "a" }];
    expect(mergePage(prev, [], keyOf)).toBe(prev);
    expect(mergePage(prev, [{ id: "a" }], keyOf)).toBe(prev);
  });
});

describe("insertActiveSession", () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}` }));

  it("leaves the list untouched when the active row is already loaded", () => {
    const active = { id: "s3" };
    expect(insertActiveSession(six, active, SESSION_PAGE_SIZE_GROUPED, keyOf)).toBe(six);
  });

  it("leaves the list untouched without an active row", () => {
    expect(insertActiveSession(six, null, SESSION_PAGE_SIZE_GROUPED, keyOf)).toBe(six);
  });

  it("injects an unloaded row at the tail of the first page", () => {
    const active = { id: "old" };
    const result = insertActiveSession(six, active, SESSION_PAGE_SIZE_GROUPED, keyOf);
    expect(result.map(keyOf)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "old"]);
  });

  it("keeps later pages after the injected row", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` }));
    const active = { id: "old" };
    const result = insertActiveSession(many, active, SESSION_PAGE_SIZE_GROUPED, keyOf);
    expect(result.map(keyOf)).toEqual([
      "s0", "s1", "s2", "s3", "s4", "s5",
      "old",
      "s6", "s7", "s8", "s9", "s10", "s11",
    ]);
  });

  it("appends at the end when fewer than one page is loaded", () => {
    const partial = [{ id: "s0" }, { id: "s1" }];
    const active = { id: "old" };
    expect(insertActiveSession(partial, active, SESSION_PAGE_SIZE_GROUPED, keyOf).map(keyOf)).toEqual([
      "s0", "s1", "old",
    ]);
  });
});

describe("refreshLimit", () => {
  it("never asks for less than one page", () => {
    expect(refreshLimit(6, 0)).toBe(6);
    expect(refreshLimit(6, 1)).toBe(6);
    expect(refreshLimit(6, 6)).toBe(6);
  });

  it("keeps the depth already loaded", () => {
    expect(refreshLimit(6, 18)).toBe(18);
    expect(refreshLimit(5, 12)).toBe(12);
  });
});

describe("decideLoadMoreOnScroll", () => {
  const metricsWithDistance = (distance: number): ScrollMetrics => ({
    scrollHeight: 5000,
    scrollTop: 5000 - 600 - distance,
    clientHeight: 600,
  });

  const base = { thresholdPx: 200, hasMore: true, loading: false, rowCount: 3 };

  it("loads when within the threshold, has more and is idle", () => {
    expect(decideLoadMoreOnScroll({ ...base, metrics: metricsWithDistance(0) })).toBe(true);
    expect(decideLoadMoreOnScroll({ ...base, metrics: metricsWithDistance(200) })).toBe(true);
  });

  it("does not load past the threshold", () => {
    expect(decideLoadMoreOnScroll({ ...base, metrics: metricsWithDistance(201) })).toBe(false);
  });

  it("does not load without more pages or while already loading", () => {
    expect(decideLoadMoreOnScroll({ ...base, hasMore: false, metrics: metricsWithDistance(0) })).toBe(false);
    expect(decideLoadMoreOnScroll({ ...base, loading: true, metrics: metricsWithDistance(0) })).toBe(false);
  });

  it("does not load from an empty list", () => {
    expect(decideLoadMoreOnScroll({ ...base, rowCount: 0, metrics: metricsWithDistance(0) })).toBe(false);
  });

  it("does not load before the container is measured", () => {
    expect(decideLoadMoreOnScroll({ ...base, metrics: null })).toBe(false);
  });
});

describe("decideChainLoad", () => {
  const base = { hasMore: true, loading: false, chainCount: 0 };
  const unscrollable: ScrollMetrics = { scrollHeight: 400, scrollTop: 0, clientHeight: 600 };

  it("chains when the container cannot scroll, has more and is under the cap", () => {
    expect(decideChainLoad({ ...base, metrics: unscrollable })).toBe(true);
  });

  it("stops at the cap (the cap lives in the module)", () => {
    expect(decideChainLoad({ ...base, chainCount: CHAIN_LOAD_LIMIT, metrics: unscrollable })).toBe(false);
  });

  it("refuses a collapsed container (zero layout)", () => {
    expect(
      decideChainLoad({ ...base, metrics: { scrollHeight: 0, scrollTop: 0, clientHeight: 0 } }),
    ).toBe(false);
  });

  it("does not chain while a scrollable page is on screen", () => {
    expect(
      decideChainLoad({ ...base, metrics: { scrollHeight: 5000, scrollTop: 0, clientHeight: 600 } }),
    ).toBe(false);
  });

  it("does not chain without more pages or while loading", () => {
    expect(decideChainLoad({ ...base, hasMore: false, metrics: unscrollable })).toBe(false);
    expect(decideChainLoad({ ...base, loading: true, metrics: unscrollable })).toBe(false);
  });

  it("does not chain before the container is measured", () => {
    expect(decideChainLoad({ ...base, metrics: null })).toBe(false);
  });
});

describe("showChainFallback", () => {
  it("shows only when there is layout, no scroll and more to load", () => {
    expect(
      showChainFallback({ hasMore: true, metrics: { scrollHeight: 400, scrollTop: 0, clientHeight: 600 } }),
    ).toBe(true);
  });

  it("hides on a scrollable page, without more pages, or without layout", () => {
    expect(
      showChainFallback({ hasMore: true, metrics: { scrollHeight: 5000, scrollTop: 0, clientHeight: 600 } }),
    ).toBe(false);
    expect(
      showChainFallback({ hasMore: false, metrics: { scrollHeight: 400, scrollTop: 0, clientHeight: 600 } }),
    ).toBe(false);
    expect(showChainFallback({ hasMore: true, metrics: null })).toBe(false);
    expect(
      showChainFallback({ hasMore: true, metrics: { scrollHeight: 0, scrollTop: 0, clientHeight: 0 } }),
    ).toBe(false);
  });
});
