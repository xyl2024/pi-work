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
// Sacrifice order (first to go → last to go), decided with the product owner:
//   1. the context readout (ring stays, numbers move to the tooltip)
//   2. the tools label
//   3. the thinking-level label (+ the row's gaps tighten)
//   4. thinking + tools fold into the More menu
//   5. the model name 220 → 160 → 120 → provider icon
//   6. the cwd (working directory) name → icon only
//   7. the cwd control folds into the More menu
//
// Identity labels (which model, which cwd) outlive the secondary labels on
// purpose: the user can always answer "what am I talking to" without hovering,
// and the More menu carries the tool/thinking affordances instead.
//
// This module is the single definition of "width → what the toolbar looks
// like". It is a pure function on purpose: the mapping is the only part of the
// feature that can be verified outside a browser.

/** Items that can be folded into the More menu when the row gets very narrow. */
export type CollapsedToolbarItem = "thinking" | "tools" | "cwd";

export type ToolbarTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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
 * tier 0, and so on down to `[7] = 220` for tier 7. Tier 8 has no lower bound.
 *
 * The numbers are re-measured against the sacrifice order above: model
 * 220/160/120 / cwd ≈120 (icon 32) / context readout ≈45 (ring ≈30) / tools
 * label ≈70 (icon 31) / thinking label ≈90 (icon 31) / round buttons 32, with
 * ~15px of slack per tier and room for the wider Chinese labels.
 *
 * If a tier triggers too early or too late while dragging, change the numbers
 * here — not the structure (priority order, hysteresis, floors).
 */
export const TOOLBAR_TIER_THRESHOLDS = [700, 660, 560, 490, 430, 390, 305, 220] as const;

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
  // 1. The context readout goes first — the ring alone still answers "how full".
  1: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: true,
    thinkingLabelVisible: true,
    buttonGap: 6,
    collapsed: [],
  },
  // 2 + 3. Tools / thinking labels drop to icons, and the row tightens its gaps.
  2: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: [],
  },
  // 4. Those two affordances move into the More menu; the model name and the
  //    cwd name are still worth their width.
  3: {
    modelLabelWidth: 220,
    cwdLabelVisible: true,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  // 5. Only now does the model name start shrinking: 220 → 160 → 120 → icon.
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
  // 6. The cwd name is the last label standing; the full path stays in the tooltip.
  7: {
    modelLabelWidth: null,
    cwdLabelVisible: false,
    contextBarCompact: true,
    toolsLabelVisible: false,
    thinkingLabelVisible: false,
    buttonGap: 2,
    collapsed: ["thinking", "tools"],
  },
  // 7. Last resort: the cwd control joins them in the menu. Below this the row
  //    is icon-only (new / upload / model / context ring / shield / more).
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
