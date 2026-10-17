// ── Right-bar button column: descriptor registry ────────────────────────
// Single source of truth for every button in the 36×36 column on the right
// edge of AppShell. Adding a new toggle-button is a two-line change:
//
//   1. register the panel identity in `lib/shared/panelTabs`
//      (PANEL_TAB_SPEC_BY_KIND — tab id, label key, default mode, session
//      binding, optional command-palette entries), then
//   2. add one presentation entry here (glyph / disabled rule / badge) and
//      one body entry in AppShell's `PANEL_BODY_BY_KIND`.
//
// The glyph lives here, once: the button column, the tab strip
// (`PANEL_TAB_ICON_BY_KIND`) and the command palette all read this entry, so
// there is no second icon chain to keep in sync. The panel body stays with
// the shell because it reads the shell's live session state.
//
// Everything behavioural — which button opens which panel, what "click the
// active button" does, the ordering — is derived from that registry, so this
// file never restates it.
//
// Two kinds of descriptors:
//   - 'fixed'      — always visible, not in right_side_bar config, no
//                    user-toggleable hidden state. Panel toggle (top).
//   - 'configurable' — managed by RightSideBarConfig: each id has a boolean
//                    visibility flag and an optional position in
//                    `order` (see lib/config.ts). Settings modal lays them
//                    out in this order.
//
// Ctx is the bridge to AppShell's imperative state — descriptors only read
// through the ctx for state, and write via the callbacks it exposes.

import type { ReactNode } from "react";
import type { RightBarButtonId } from "@/lib/shared/right-bar";
import {
  PANEL_BUTTON_ID_BY_KIND,
  PANEL_TAB_KINDS,
  PANEL_TAB_SPECS,
  PANEL_TAB_SPEC_BY_KIND,
  type PanelMode,
  type PanelTabKind,
  type PanelViewKind,
} from "@/lib/shared/panelTabs";
import {
  Bot,
  ChartColumn,
  ChartSpline,
  GitBranch,
  GitGraph,
  Languages,
  PanelRight,
  Star,
} from "lucide-react";
import { ProviderGearIcon } from "../../ui/ProviderIcon";
import { ToolIcon } from "../../ui/icons";

/** Options for rendering a panel view's glyph. The right-bar button, the tab
 *  strip and the command palette share one icon per kind, differing only in
 *  size and whether the view is active. */
export interface PanelIconOptions {
  size: number;
  active: boolean;
}
export type PanelIcon = (options: PanelIconOptions) => ReactNode;

export interface RightBarCtx {
  // ── observed state ──
  /** The panel's own open state (see panelTabs). */
  rightPanelState: PanelMode;
  /** Kind of the strip's active tab, null while the panel is collapsed. */
  activeTabKind: PanelTabKind | null;
  selectedSessionId: string | null;
  selectedCwd: string | null;
  /** The models-config draft differs from `models.json` on disk. Lives in the
   *  ctx — not in the panel body — because the button must keep the dirty
   *  badge while the panel is collapsed. */
  modelsConfigDirty: boolean;
  /** Active tool-call counter is the only thing that requires i18n inside
   *  the descriptor body, so we expose the AppShell-bound t() to avoid
   *  re-resolving the same key in two places. */
  t: (key: string) => string;

  // ── mutators ──
  /** Collapse the panel when open, reopen it otherwise. */
  toggleRightPanel: () => void;
  /** The single toggle rule: reveal the view, or collapse the panel when
   *  that view is already the active, open tab. Every panel entry point
   *  (right-bar button, command palette) goes through this. */
  togglePanel: (kind: PanelViewKind) => void;
}

export interface RightBarDescriptor {
  /** Identifier; required for 'configurable' descriptors (persisted in
   *  right_side_bar.buttons and order). 'fixed' descriptors use the
   *  reserved id 'panelToggle' (top, always visible). */
  id: RightBarButtonId | "panelToggle";
  kind: "fixed" | "configurable";
  /** For configurable entries: the panel view this button toggles. Lets the
   *  registry (and the tests) check the button ↔ panel link in one place. */
  panelKind?: PanelViewKind;
  /** Visual slot — 'top' renders above the configurable row. Undefined =
   *  inline (renders among the configurable row, in user-configured
   *  order). 'bottom' is reserved for legacy slots registered through
   *  this module. */
  slot?: "top" | "bottom";
  /** True when the button reads from active-session-bound state (system
   *  prompt / tools, per-session tool-call stats, branch tree, cwd's git
   *  status, per-session LLM audit). Such buttons become empty/disabled
   *  on the new-session page, so the configurable row groups them by
   *  `cfg.session_bound_alignment` so the user can decide whether they
   *  sit at the top, bottom, or interleave with the global buttons. */
  sessionBound?: true;
  /** Translation key consumed by `t()`. */
  labelKey: string;
  /** The entry's glyph, declared exactly once: the right-bar button, the tab
   *  strip (`PANEL_TAB_ICON_BY_KIND`) and the command palette all read it. */
  icon: PanelIcon;
  /** Optional top-right corner badge (active tool-call count etc.). */
  badge?: (ctx: RightBarCtx) => ReactNode | null;
  isActive: (ctx: RightBarCtx) => boolean;
  isDisabled?: (ctx: RightBarCtx) => boolean;
  /** Optional visibility predicate. Defaults to always-true. */
  isVisible?: (ctx: RightBarCtx) => boolean;
  onClick: (ctx: RightBarCtx) => void;
}

// ── Descriptors ──
// Order in this array is irrelevant for the configurable group — that
// ordering is driven by `cfg.order ?? this default`. The order here only
// affects the implicit "default order" used when no user override exists.

// Fixed: panel toggle (top of column).
const panelToggleDescriptor: RightBarDescriptor = {
  id: "panelToggle",
  kind: "fixed",
  slot: "top",
  labelKey: "", // resolved below — active/inactive have different labels
  icon: ({ size }) => <PanelRight size={size} />,
  isActive: (ctx) => ctx.rightPanelState !== "closed",
  onClick: (ctx) => ctx.toggleRightPanel(),
};

// Configurable: one entry per panel view. Identity (button id, tab id,
// session binding) and behaviour (active state, click = toggle) come from the
// panel registry; only presentation is declared here.
function panelButton(
  kind: PanelViewKind,
  presentation: {
    labelKey: string;
    icon: PanelIcon;
    isDisabled?: (ctx: RightBarCtx) => boolean;
    badge?: (ctx: RightBarCtx) => ReactNode | null;
  },
): RightBarDescriptor {
  const buttonId = PANEL_BUTTON_ID_BY_KIND[kind];
  const spec = PANEL_TAB_SPEC_BY_KIND[buttonId];
  return {
    id: buttonId,
    kind: "configurable",
    panelKind: kind,
    labelKey: presentation.labelKey,
    icon: presentation.icon,
    isActive: (ctx) => ctx.activeTabKind === kind,
    onClick: (ctx) => ctx.togglePanel(kind),
    ...(spec.sessionBound ? { sessionBound: true as const } : {}),
    ...(presentation.isDisabled ? { isDisabled: presentation.isDisabled } : {}),
    ...(presentation.badge ? { badge: presentation.badge } : {}),
  };
}

// Declaration order below is the default Settings / command-palette order.
const PANEL_DESCRIPTOR_BY_KIND: Record<PanelViewKind, RightBarDescriptor> = {
  context: panelButton("context", {
    labelKey: "Context",
    icon: ({ size }) => <Bot size={size} />,
  }),
  translate: panelButton("translate", {
    labelKey: "Open translate",
    icon: ({ size }) => <Languages size={size} />,
  }),
  // Cwd-derived (one repo per active session) — treated as session-bound
  // for column layout so it pins with the other "live state" buttons.
  gitDiff: panelButton("gitDiff", {
    labelKey: "Open git diff",
    // Disabled when there's no cwd at all (no selected session, no
    // in-flight new-session cwd) — matches the original inline guard.
    isDisabled: (ctx) => !ctx.selectedCwd,
    icon: ({ size }) => <GitGraph size={size} />,
  }),
  favorites: panelButton("favorites", {
    labelKey: "Open favorites",
    // Active state uses fill="var(--accent)" instead of just the color flip,
    // matching the original star and the tab-bar icon.
    icon: ({ size, active }) => (
      <Star size={size} fill={active ? "var(--accent)" : "none"} />
    ),
  }),
  tokens: panelButton("tokens", {
    labelKey: "Open token audit",
    icon: ({ size }) => <ChartSpline size={size} />,
  }),
  llmAudit: panelButton("llmAudit", {
    labelKey: "Open LLM API audit",
    icon: ({ size }) => <ChartColumn size={size} />,
  }),
  modelsConfig: panelButton("modelsConfig", {
    // The tooltip keeps the long "Open …" wording; the tab strip uses the
    // shorter "Models config" label from the registry — same glyph for both.
    labelKey: "Open models config",
    // Reuse the gear the model cards already show for providers without an
    // icon, so button / tab / palette render the same glyph. `inherit` lets
    // the glyph flip with the host's active / hover colour.
    icon: ({ size }) => <ProviderGearIcon size={size} color="inherit" />,
    // Unsaved-changes dot: the one wire-up for the descriptor badge hook. It
    // is shown while the panel is collapsed too, because the dirty flag lives
    // in the module store, not in the panel mount.
    badge: (ctx) =>
      ctx.modelsConfigDirty ? (
        <span
          aria-hidden="true"
          style={{ position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 0 2px var(--bg-panel)" }}
        />
      ) : null,
  }),
  skills: panelButton("skills", {
    // Same long "Open …" wording as the models-config button; the tab strip
    // uses the shorter "Skills" label from the registry — one glyph for both.
    labelKey: "Open skills",
    // Wrench: the same generic tool glyph the chat's SKILL.md file chip
    // renders (`ReadFileChips`), so button / strip / palette and the chip
    // read as one idea.
    icon: ({ size }) => <ToolIcon size={size} />,
  }),
  conversationTree: panelButton("conversationTree", {
    labelKey: "Open conversation tree",
    isDisabled: (ctx) => !ctx.selectedSessionId && !ctx.selectedCwd,
    icon: ({ size }) => <GitBranch size={size} />,
  }),
};

export const RIGHT_BAR_DESCRIPTORS: readonly RightBarDescriptor[] = [
  // 'fixed' group
  panelToggleDescriptor,
  // 'configurable' group — order follows the panel registry, which is also
  // the implicit default order used when the user hasn't customized
  // `cfg.order`.
  ...PANEL_TAB_KINDS.map((kind) => PANEL_DESCRIPTOR_BY_KIND[kind]),
];

/** Icon per panel kind, from the same presentation entries the right-bar
 *  column uses. The tab strip is the only other consumer, so the glyph is
 *  declared once in `PANEL_DESCRIPTOR_BY_KIND` and looked up here by kind. */
export const PANEL_TAB_ICON_BY_KIND: Record<PanelViewKind, PanelIcon> =
  Object.fromEntries(
    PANEL_TAB_KINDS.map((kind) => [kind, PANEL_DESCRIPTOR_BY_KIND[kind].icon]),
  ) as Record<PanelViewKind, PanelIcon>;

/** Command-palette icon per panel kind, for the specs that opt into a
 *  palette command — the same glyph at button size, never active. Panels
 *  with no palette entry keep no icon (the palette falls back to null). */
export const PANEL_COMMAND_ICON_BY_KIND: Partial<Record<PanelViewKind, ReactNode>> =
  Object.fromEntries(
    PANEL_TAB_SPECS.filter((spec) => spec.commands?.length).map((spec) => [
      spec.kind,
      PANEL_TAB_ICON_BY_KIND[spec.kind]({ size: 16, active: false }),
    ]),
  ) as Partial<Record<PanelViewKind, ReactNode>>;

// Tab.kind → RightBarButtonId reverse lookup is derived from the registry in
// `lib/shared/panelTabs` (`panelButtonIdForKind`) — no second mapping here.

/** Configureable ids, in declaration order (the default Settings ordering
 *  the user sees when no custom order is set). */
export const RIGHT_BAR_BUTTON_IDS: readonly RightBarButtonId[] =
  RIGHT_BAR_DESCRIPTORS.filter((d) => d.kind === "configurable").map(
    (d) => d.id as RightBarButtonId,
  );

/** True when a configurable descriptor reads from active-session-bound
 *  state. Used by RightBarColumn to split the configurable row into the
 *  two groups consumed by `cfg.session_bound_alignment`. */
export function isSessionBoundDescriptor(desc: RightBarDescriptor): boolean {
  return desc.sessionBound === true;
}

/** Map a descriptor id back to its descriptor (O(1)). */
export const RIGHT_BAR_DESCRIPTOR_BY_ID: ReadonlyMap<
  RightBarDescriptor["id"],
  RightBarDescriptor
> = new Map(RIGHT_BAR_DESCRIPTORS.map((d) => [d.id, d]));

/** Resolve the user-visible label for a button. Handles descriptors whose
 *  label flips based on state (panel toggle: Hide/Show; expand: Collapse/
 *  Expand). */
export function resolveButtonLabel(
  desc: RightBarDescriptor,
  ctx: RightBarCtx,
): string {
  switch (desc.id) {
    case "panelToggle":
      return ctx.t(
        ctx.rightPanelState !== "closed" ? "Hide file panel" : "Show file panel",
      );
    default:
      return ctx.t(desc.labelKey);
  }
}
