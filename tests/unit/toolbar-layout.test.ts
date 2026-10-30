import { describe, expect, it } from "vitest";
import {
  INITIAL_TOOLBAR_LAYOUT,
  TOOLBAR_HYSTERESIS_PX,
  TOOLBAR_TIER_THRESHOLDS,
  resolveToolbarLayout,
  type ToolbarLayout,
} from "@/lib/shared/toolbarLayout";

function layoutAt(width: number, prev: ToolbarLayout | null = null) {
  return resolveToolbarLayout(width, prev);
}

function walk(widths: number[]): ToolbarLayout[] {
  const out: ToolbarLayout[] = [];
  let prev: ToolbarLayout | null = null;
  for (const width of widths) {
    prev = layoutAt(width, prev);
    out.push(prev);
  }
  return out;
}

describe("resolveToolbarLayout — tiers (sacrifice order)", () => {
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

  it("drops the context readout first, keeping the ring (660–700)", () => {
    expect(layoutAt(680)).toEqual({
      tier: 1,
      modelLabelWidth: 220,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: true,
      thinkingLabelVisible: true,
      buttonGap: 6,
      collapsed: [],
    });
  });

  it("turns the tools and thinking labels into icons and tightens gaps (560–660)", () => {
    expect(layoutAt(610)).toEqual({
      tier: 2,
      modelLabelWidth: 220,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: [],
    });
  });

  it("folds thinking and tools into the More menu (490–560)", () => {
    expect(layoutAt(525)).toEqual({
      tier: 3,
      modelLabelWidth: 220,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools"],
    });
  });

  it("shortens the model name to 160 only after that (430–490)", () => {
    expect(layoutAt(460)).toEqual({
      tier: 4,
      modelLabelWidth: 160,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools"],
    });
  });

  it("shortens the model name to 120 next (390–430)", () => {
    expect(layoutAt(410)).toEqual({
      tier: 5,
      modelLabelWidth: 120,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools"],
    });
  });

  it("reduces the model to its provider icon (305–390)", () => {
    expect(layoutAt(347)).toEqual({
      tier: 6,
      modelLabelWidth: null,
      cwdLabelVisible: true,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools"],
    });
  });

  it("turns the cwd name into an icon, its path into the tooltip (220–305)", () => {
    expect(layoutAt(262)).toEqual({
      tier: 7,
      modelLabelWidth: null,
      cwdLabelVisible: false,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools"],
    });
  });

  it("folds the cwd control into the More menu last (< 220)", () => {
    expect(layoutAt(150)).toEqual({
      tier: 8,
      modelLabelWidth: null,
      cwdLabelVisible: false,
      contextBarCompact: true,
      toolsLabelVisible: false,
      thinkingLabelVisible: false,
      buttonGap: 2,
      collapsed: ["thinking", "tools", "cwd"],
    });
  });

  it("never sacrifices the model name before the secondary labels are gone", () => {
    for (const width of [680, 610, 525]) {
      expect(layoutAt(width).modelLabelWidth).toBe(220);
      expect(layoutAt(width).cwdLabelVisible).toBe(true);
    }
    expect(layoutAt(262).collapsed).toEqual(["thinking", "tools"]);
  });
});

describe("resolveToolbarLayout — tier boundaries", () => {
  it.each([
    [701, 0],
    [700, 0],
    [699, 1],
    [661, 1],
    [660, 1],
    [659, 2],
    [561, 2],
    [560, 2],
    [559, 3],
    [491, 3],
    [490, 3],
    [489, 4],
    [431, 4],
    [430, 4],
    [429, 5],
    [391, 5],
    [390, 5],
    [389, 6],
    [306, 6],
    [305, 6],
    [304, 7],
    [221, 7],
    [220, 7],
    [219, 8],
  ])("resolves %ipx to tier %i", (width, tier) => {
    expect(layoutAt(width).tier).toBe(tier);
  });
});

describe("resolveToolbarLayout — hysteresis", () => {
  it("does not flip back and forth while dragging on a boundary", () => {
    const [seed, shrunk, grown, settled] = walk([700, 690, 710, 695]);
    expect(seed.tier).toBe(0);
    expect(shrunk.tier).toBe(1);
    expect(grown.tier).toBe(1);
    expect(settled.tier).toBe(1);

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
    const narrow = layoutAt(380);
    expect(narrow.tier).toBe(6);

    const first = layoutAt(500, narrow);
    expect(first.tier).toBe(4);

    const again = layoutAt(500, first);
    expect(again.tier).toBe(4);

    const widened = layoutAt(570, again);
    expect(widened.tier).toBe(3);
  });

  it("expands fully once every buffer is cleared", () => {
    const narrow = layoutAt(150);
    expect(narrow.tier).toBe(8);
    expect(layoutAt(900, narrow).tier).toBe(0);
  });
});

describe("resolveToolbarLayout — no-`prev` path", () => {
  it("is a fixed point when its own result is fed back in", () => {
    for (let width = 150; width <= 900; width += 7) {
      const resolved = layoutAt(width);
      expect(layoutAt(width, resolved)).toEqual(resolved);
    }
  });

  it("matches the `prev`-based path when the layout already agrees with the width", () => {
    expect(layoutAt(460, layoutAt(460))).toEqual(layoutAt(460));
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
    for (const width of [1200, 700, 659, 489, 389, 219, 120, 0]) {
      expect(Object.keys(layoutAt(width)).sort()).toEqual(LAYOUT_KEYS);
    }
  });

  it("keeps the context ring in every tier (compact still shows the ring)", () => {
    const widths = [800, 680, 610, 525, 460, 410, 347, 262, 150];
    const compactFlags = widths.map((w) => layoutAt(w).contextBarCompact);
    expect(compactFlags).toEqual([false, true, true, true, true, true, true, true, true]);
  });

  it("exposes the fully expanded layout as the pre-measurement default", () => {
    expect(INITIAL_TOOLBAR_LAYOUT).toEqual(layoutAt(1000));
    expect(INITIAL_TOOLBAR_LAYOUT.tier).toBe(0);
  });

  it("never collapses the model into the menu", () => {
    for (const width of [400, 300, 220, 200, 0]) {
      expect(layoutAt(width).collapsed).not.toContain("model");
    }
  });
});
