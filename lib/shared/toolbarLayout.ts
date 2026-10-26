// Width → layout plan for the chat input's bottom toolbar.
//
// The toolbar is a single non-wrapping flex row, and none of its groups can
// shrink on their own (every one of them is `flex: 0 0 auto`). When the chat
// column gets narrow — the usual cause is the session sidebar plus the right
// panel being open at once — the row does not compress, it overflows to the
// right and gets clipped, taking the right-most buttons (shield / notify /
// more) with it.
//
// So the row degrades by tiers instead: as the measured container width
// shrinks we trade information density (label → icon → menu) in a fixed
// priority order. Two hard floors: the context ring and the upload button are
// never hidden (the ring is the only permanent "context is filling up" signal;
// hiding upload hides the feature for anyone who does not know about
// drag-and-drop), and nothing here ever introduces horizontal scrolling or
// wrapping.
//
// This module is the single definition of "width → what the toolbar looks
// like". It is a pure function on purpose: the mapping is the only part of the
// feature that can be verified outside a browser.

/** Items that can be folded into the More menu when the row gets very narrow. */
export type CollapsedToolbarItem = "thinking" | "tools" | "cwd";

export type ToolbarTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface ToolbarLayout {
  tier: ToolbarTier;
  /** maxWidth of the model button's name; `null` = keep only the provider icon. */
  modelLabelWidth: number | null;
  /** False = the cwd picker shows its icon only (full path goes to the tooltip). */
  cwdLabelVisible: boolean;
  /** True = the context indicator keeps the ring but drops its token readout. */
  contextBarCompact: boolean;
  toolsLabelVisible: boolean;
  thinkingLabelVisible: boolean;
  /** Gap between the toolbar's top-level groups. */
  buttonGap: number;
  /** Items moved out of the row and into the More menu. */
  collapsed: CollapsedToolbarItem[];
}

/**
 * Lower bound of each tier's width range, measured in px of container content
 * width (never viewport width — the chat column also loses width to both side
 * panels, so a viewport breakpoint cannot see the real constraint).
 *
 * Index is the tier: `TOOLBAR_TIER_THRESHOLDS[0] = 700` is the lower bound of
 * tier 0, and so on down to `[4] = 400` for tier 4. Tier 5 has no lower bound.
 *
 * The numbers are measured, not derived: model 220 / cwd 160 / context bar
 * ≈75 / thinking and tools ≈31 / round buttons 32, with the "everything is an
 * icon" floor at ≈340–360px. Tier 5 exists because that floor is still wider
 * than the real dual-panel case.
 *
 * If a tier triggers too early or too late while dragging, change the numbers
 * here — not the structure (priority order, hysteresis, floors).
 */
export const TOOLBAR_TIER_THRESHOLDS = [700, 620, 540, 470, 400] as const;

/**
 * Hysteresis buffer for widening. Narrowing applies immediately (`width < T`
 * drops a tier), widening requires clearing `T + 24` so a one-pixel drag on a
 * boundary does not flip the layout back and forth.
 */
export const TOOLBAR_HYSTERESIS_PX = 24;

type TierSpec = Omit<ToolbarLayout, "tier" | "collapsed"> & {
  collapsed: readonly CollapsedToolbarItem[];
};

const TIER_SPECS: Record<ToolbarTier, TierSpec> = {
  // Widest: exactly today's behaviour.
  0: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: false,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  // Model name is the first thing to go — it is the only truncatable label.
  1: {
    modelLabelWidth: 160,
    cwdLabelVisible: true,
    contextBarCompact: false,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  // Model name shrinks again; the cwd name falls back to its icon.
  2: {
    modelLabelWidth: 120,
    cwdLabelVisible: false,
    contextBarCompact: false,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  // Model becomes an icon; the context bar keeps the ring only.
  3: {
    modelLabelWidth: null,
    cwdLabelVisible: false,
    contextBarCompact: true,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  // Text labels on tools / thinking drop; the row tightens its gaps.
  4: {
    modelLabelWidth: null,
    cwdLabelVisible: false,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: [],
  },
  // Below the all-icon floor: the three affordances that still open a surface
  // move into the More menu rather than overflowing.
  5: {
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
  return 5;
}

function layoutForTier(tier: ToolbarTier): ToolbarLayout {
  const spec = TIER_SPECS[tier];
  // Fresh array per call: callers must not be able to mutate a shared table.
  return { tier, ...spec, collapsed: [...spec.collapsed] };
}

/**
 * Resolve the toolbar layout for a measured container width.
 *
 * Pass the previous frame's layout as `prev` to get hysteresis: shrinking
 * applies at once, growing has to clear `threshold + TOOLBAR_HYSTERESIS_PX`.
 * Without `prev` (first frame, SSR, tests) the layout is evaluated with no
 * hysteresis — but feeding that value back in as `prev` at the same width is a
 * fixed point, so both paths agree once the layout settles.
 */
export function resolveToolbarLayout(
  width: number,
  prev: ToolbarLayout | null = null,
): ToolbarLayout {
  const natural = tierForWidth(width);
  // Same tier, or narrower than before: degrade immediately.
  if (!prev || natural >= prev.tier) return layoutForTier(natural);

  // Widening: climb back one boundary at a time, each one needing the buffer.
  let tier = prev.tier;
  for (let candidate = prev.tier - 1; candidate >= natural; candidate--) {
    const lowerBound = TOOLBAR_TIER_THRESHOLDS[candidate] + TOOLBAR_HYSTERESIS_PX;
    if (width < lowerBound) break;
    tier = candidate as ToolbarTier;
  }
  return layoutForTier(tier);
}

/**
 * The layout used before the first measurement lands (and the SSR default):
 * fully expanded, i.e. the toolbar exactly as it renders today. Starting wide
 * rather than narrow means the first measured frame can only tighten, never
 * flash a row of bare icons.
 *
 * Frozen because it is shared by every toolbar instance; a consumer that
 * wanted a different plan has to resolve a fresh one, not mutate the default.
 */
export const INITIAL_TOOLBAR_LAYOUT: ToolbarLayout = Object.freeze(layoutForTier(0));
