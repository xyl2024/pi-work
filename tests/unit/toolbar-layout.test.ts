import { describe, expect, it } from "vitest";
import {
  INITIAL_TOOLBAR_LAYOUT,
  TOOLBAR_HYSTERESIS_PX,
  TOOLBAR_TIER_THRESHOLDS,
  resolveToolbarLayout,
  type ToolbarLayout,
} from "@/lib/shared/toolbarLayout";

// "Width → toolbar layout" is the one automatable seam of the narrow-toolbar
// feature: everything else is JSX. These tests therefore assert the resolved
// layout only — never `tier` alone, because the individual flags are what the
// toolbar actually consumes.

function layoutAt(width: number, prev: ToolbarLayout | null = null) {
  return resolveToolbarLayout(width, prev);
}

/** Feed widths through in order, threading each result in as `prev`. */
function walk(widths: number[]): ToolbarLayout[] {
  const out: ToolbarLayout[] = [];
  let prev: ToolbarLayout | null = null;
  for (const width of widths) {
    prev = layoutAt(width, prev);
    out.push(prev);
  }
  return out;
}

describe("resolveToolbarLayout — tiers", () => {
  it("keeps the fully expanded layout at and above 700px", () => {
    expect(layoutAt(980)).toEqual({
      tier: 0,
      modelLabelWidth: 220,
      cwdLabelVisible: true,
      contextBarCompact: false,
      toolsLabelVisible: true,
      thinkingLabelVisible: true,
      buttonGap: 6,
      collapsed: [],
    });
  });

  it("shortens the model name first (620–700)", () => {
    expect(layoutAt(660)).toEqual({
      tier: 1,
      modelLabelWidth: 160,
      cwdLabelVisible: true,
      contextBarCompact: false,
      toolsLabelVisible: true,
      thinkingLabelVisible: true,
      buttonGap: 6,
      collapsed: [],
    });
  });

  it("shrinks the model name again and drops the project name (540–620)", () => {
    expect(layoutAt(580)).toEqual({
      tier: 2,
      modelLabelWidth: 120,
      cwdLabelVisible: false,
      contextBarCompact: false,
      toolsLabelVisible: true,
      thinkingLabelVisible: true,
      buttonGap: 6,
      collapsed: [],
    });
  });

  it("reduces the model to its icon and the context bar to its ring (470–540)", () => {
    expect(layoutAt(505)).toEqual({
      tier: 3,
      modelLabelWidth: null,
      cwdLabelVisible: false,
      contextBarCompact: true,
      toolsLabelVisible: true,
      thinkingLabelVisible: true,
      buttonGap: 6,
      collapsed: [],
    });
  });

  it("drops the tools and thinking labels and tightens the gaps (400–470)", () => {
    expect(layoutAt(435)).toEqual({
      tier: 4,
      modelLabelWidth: null,
      cwdLabelVisible: false,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: [],
    });
  });

  it("folds thinking, tools and project into the More menu below 400px", () => {
    expect(layoutAt(350)).toEqual({
      tier: 5,
      modelLabelWidth: null,
      cwdLabelVisible: false,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools", "cwd"],
    });
  });
});

describe("resolveToolbarLayout — tier boundaries", () => {
  it.each([
    // Both sides of every boundary: exact lower bound, one pixel under it and
    // one pixel above it.
    [701, 0],
    [700, 0],
    [699, 1],
    [621, 1],
    [620, 1],
    [619, 2],
    [541, 2],
    [540, 2],
    [539, 3],
    [471, 3],
    [470, 3],
    [469, 4],
    [401, 4],
    [400, 4],
    [399, 5],
  ])("resolves %ipx to tier %i", (width, tier) => {
    expect(layoutAt(width).tier).toBe(tier);
  });
});

describe("resolveToolbarLayout — hysteresis", () => {
  it("does not flip back and forth while dragging on a boundary", () => {
    // 700 → 690 tightens to tier 1; 710 would be tier 0 without hysteresis,
    // but growing has to clear 700 + 24 first.
    const [seed, shrunk, grown, settled] = walk([700, 690, 710, 695]);
    expect(seed.tier).toBe(0);
    expect(shrunk.tier).toBe(1);
    expect(grown.tier).toBe(1);
    expect(settled.tier).toBe(1);

    // Only past the buffer does it expand again.
    const wide = layoutAt(TOOLBAR_TIER_THRESHOLDS[0] + TOOLBAR_HYSTERESIS_PX, settled);
    expect(wide.tier).toBe(0);
    const justUnderBuffer = layoutAt(TOOLBAR_TIER_THRESHOLDS[0] + TOOLBAR_HYSTERESIS_PX - 1, settled);
    expect(justUnderBuffer.tier).toBe(1);
  });

  it("narrows immediately, with no buffer in the tight direction", () => {
    const wide = layoutAt(800);
    expect(wide.tier).toBe(0);
    expect(layoutAt(TOOLBAR_TIER_THRESHOLDS[0] - 1, wide).tier).toBe(1);
  });

  it("only crosses boundaries whose own buffer is cleared", () => {
    // Widening out of the narrowest tier: every boundary needs its own +24,
    // so a single jump cannot land back on tier 0.
    const narrow = layoutAt(380);
    expect(narrow.tier).toBe(5);

    const first = layoutAt(500, narrow);
    expect(first.tier).toBe(3); // 470 + 24 = 494 ≤ 500, but 540 + 24 = 564 > 500

    const again = layoutAt(500, first);
    expect(again.tier).toBe(3); // stable: still short of the next boundary

    const widened = layoutAt(570, again);
    expect(widened.tier).toBe(2); // 540 cleared, 620 not (644)
  });

  it("expands fully once every buffer is cleared", () => {
    const narrow = layoutAt(320);
    expect(layoutAt(900, narrow).tier).toBe(0);
  });
});

describe("resolveToolbarLayout — no-`prev` path", () => {
  it("is a fixed point when its own result is fed back in", () => {
    for (let width = 300; width <= 900; width += 7) {
      const resolved = layoutAt(width);
      expect(layoutAt(width, resolved)).toEqual(resolved);
    }
  });

  it("matches the `prev`-based path when the layout already agrees with the width", () => {
    expect(layoutAt(580, layoutAt(580))).toEqual(layoutAt(580));
  });
});

describe("resolveToolbarLayout — hard floors", () => {
  const LAYOUT_KEYS = [
    "buttonGap",
    "collapsed",
    "contextBarCompact",
    "cwdLabelVisible",
    "modelLabelWidth",
    "thinkingLabelVisible",
    "tier",
    "toolsLabelVisible",
  ];

  it("offers no way to hide the context ring or the upload button at any width", () => {
    // The invariant is structural: the layout plan has no flag that could
    // hide the ring or the upload button, so no width can produce one.
    for (const width of [1200, 700, 619, 470, 399, 240, 0]) {
      expect(Object.keys(layoutAt(width)).sort()).toEqual(LAYOUT_KEYS);
    }
  });

  it("keeps the context ring present in every tier (compact still shows the ring)", () => {
    // `contextBarCompact` only drops the token readout — the ring stays in
    // every tier, so the flag is the only thing that may vary.
    const widths = [800, 660, 580, 505, 435, 350];
    const compactFlags = widths.map((w) => layoutAt(w).contextBarCompact);
    expect(compactFlags).toEqual([false, false, false, true, true, true]);
  });

  it("exposes the fully expanded layout as the pre-measurement default", () => {
    expect(INITIAL_TOOLBAR_LAYOUT).toEqual(layoutAt(1000));
    expect(INITIAL_TOOLBAR_LAYOUT.tier).toBe(0);
  });

  it("never collapses the model into the menu", () => {
    for (const width of [400, 399, 300, 200, 0]) {
      expect(layoutAt(width).collapsed).not.toContain("model");
    }
  });
});
