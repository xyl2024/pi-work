export type CollapsedToolbarItem = "thinking" | "tools" | "cwd";

export type ToolbarTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ToolbarLayout {
  tier: ToolbarTier;
  modelLabelWidth: number | null;
  cwdLabelVisible: boolean;
  contextBarCompact: boolean;
  toolsLabelVisible: boolean;
  thinkingLabelVisible: boolean;
  buttonGap: number;
  collapsed: CollapsedToolbarItem[];
}

export const TOOLBAR_TIER_THRESHOLDS = [700, 660, 560, 490, 430, 390, 305, 220] as const;

export const TOOLBAR_HYSTERESIS_PX = 24;

type TierSpec = Omit<ToolbarLayout, "tier" | "collapsed"> & {
  collapsed: readonly CollapsedToolbarItem[];
};

const TIER_SPECS: Record<ToolbarTier, TierSpec> = {
  0: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: false,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  1: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  2: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: [],
  },
  3: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  4: {
    modelLabelWidth: 160,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  5: {
    modelLabelWidth: 120,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  6: {
    modelLabelWidth: null,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  7: {
    modelLabelWidth: null,
    cwdLabelVisible: false,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  8: {
    modelLabelWidth: null,
    cwdLabelVisible: false,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools", "cwd"],
  },
};

function tierForWidth(width: number): ToolbarTier {
  for (let tier = 0; tier < TOOLBAR_TIER_THRESHOLDS.length; tier++) {
    if (width >= TOOLBAR_TIER_THRESHOLDS[tier]) return tier as ToolbarTier;
  }
  return 8;
}

function layoutForTier(tier: ToolbarTier): ToolbarLayout {
  const spec = TIER_SPECS[tier];
  return { tier, ...spec, collapsed: [...spec.collapsed] };
}

export function resolveToolbarLayout(
  width: number,
  prev: ToolbarLayout | null = null,
): ToolbarLayout {
  const natural = tierForWidth(width);
  if (!prev || natural >= prev.tier) return layoutForTier(natural);

  let tier = prev.tier;
  for (let candidate = prev.tier - 1; candidate >= natural; candidate--) {
    const lowerBound = TOOLBAR_TIER_THRESHOLDS[candidate] + TOOLBAR_HYSTERESIS_PX;
    if (width < lowerBound) break;
    tier = candidate as ToolbarTier;
  }
  return layoutForTier(tier);
}

export const INITIAL_TOOLBAR_LAYOUT: ToolbarLayout = Object.freeze(layoutForTier(0));
