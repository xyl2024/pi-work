// ── Right-bar button column: descriptor registry ────────────────────────
// Single source of truth for every button in the 36×36 column on the right
// edge of AppShell. Adding a new toggle-button is a two-line change:
//
//   1. register the panel identity in `lib/shared/panelTabs`
//      (PANEL_TAB_SPEC_BY_KIND — tab id, label key, default mode, session
//      binding, optional command-palette entry), then
//   2. add one presentation entry here (icon / body / disabled rule).
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
import { CountBadge } from "@/components/ui/CountBadge";
import {
  PANEL_BUTTON_ID_BY_KIND,
  PANEL_TAB_KINDS,
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
  MessageSquareMore,
  NotebookText,
  PanelRight,
  Rss,
  SquareKanban,
  Star,
  Wrench,
} from "lucide-react";
import GithubIcon from "@lobehub/icons/es/Github/components/Mono";

export interface RightBarCtx {
  // ── observed state ──
  /** The panel's own open state (see panelTabs). */
  rightPanelState: PanelMode;
  /** Kind of the strip's active tab, null while the panel is collapsed. */
  activeTabKind: PanelTabKind | null;
  selectedSessionId: string | null;
  selectedCwd: string | null;
  rssUnread: number;
  /** Number of changed files (M/A/D/R/C/T/? ?) for the active cwd's git
   *  repo. 0 when there's no cwd, the cwd isn't a repo, or the repo has
   *  no changes. Drives the badge on the git-diff button. */
  gitChangedCount: number;
  toolStats: { runningCount: number; totalCount: number };
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
  setRightPanelState: (s: PanelMode) => void;
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
  /** Optional top-right corner badge (RSS unread count etc.). */
  badge?: (ctx: RightBarCtx) => ReactNode | null;
  isActive: (ctx: RightBarCtx) => boolean;
  isDisabled?: (ctx: RightBarCtx) => boolean;
  /** Optional visibility predicate. Defaults to always-true. */
  isVisible?: (ctx: RightBarCtx) => boolean;
  /** Body of the button — typically an icon node, or icon+label for the
   *  tool-calls button. */
  content: (ctx: RightBarCtx) => ReactNode;
  /** Optional layout override forwarded to RightBarButton. Tool-calls uses
   *  { flexDirection: 'column', gap: 1 } to stack the icon and the
   *  running/total counter. */
  bodyLayout?: { flexDirection?: "row" | "column"; gap?: number };
  /** Icon for the generated command-palette entry. Only panels whose spec
   *  opts into a command need one; the palette falls back to nothing
   *  otherwise. */
  commandIcon?: ReactNode;
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
  isActive: (ctx) => ctx.rightPanelState !== "closed",
  content: () => <PanelRight size={16} />,
  onClick: (ctx) => ctx.toggleRightPanel(),
  // Wrap so we can swap the tooltip when active.
};

// Configurable: one entry per panel view. Identity (button id, tab id,
// session binding) and behaviour (active state, click = toggle) come from the
// panel registry; only presentation is declared here.
function panelButton(
  kind: PanelViewKind,
  presentation: {
    labelKey: string;
    content: (ctx: RightBarCtx) => ReactNode;
    commandIcon?: ReactNode;
    isDisabled?: (ctx: RightBarCtx) => boolean;
    badge?: (ctx: RightBarCtx) => ReactNode | null;
    bodyLayout?: RightBarDescriptor["bodyLayout"];
  },
): RightBarDescriptor {
  const buttonId = PANEL_BUTTON_ID_BY_KIND[kind];
  const spec = PANEL_TAB_SPEC_BY_KIND[buttonId];
  return {
    id: buttonId,
    kind: "configurable",
    panelKind: kind,
    labelKey: presentation.labelKey,
    isActive: (ctx) => ctx.activeTabKind === kind,
    onClick: (ctx) => ctx.togglePanel(kind),
    content: presentation.content,
    ...(spec.sessionBound ? { sessionBound: true as const } : {}),
    ...(presentation.commandIcon ? { commandIcon: presentation.commandIcon } : {}),
    ...(presentation.isDisabled ? { isDisabled: presentation.isDisabled } : {}),
    ...(presentation.badge ? { badge: presentation.badge } : {}),
    ...(presentation.bodyLayout ? { bodyLayout: presentation.bodyLayout } : {}),
  };
}

// Declaration order below is the default Settings / command-palette order.
const PANEL_DESCRIPTOR_BY_KIND: Record<PanelViewKind, RightBarDescriptor> = {
  context: panelButton("context", {
    labelKey: "Context",
    content: () => <Bot size={16} />,
  }),
  translate: panelButton("translate", {
    labelKey: "Open translate",
    content: () => <Languages size={16} />,
    commandIcon: <Languages size={16} />,
  }),
  rss: panelButton("rss", {
    labelKey: "RSS",
    badge: (ctx) => <CountBadge count={ctx.rssUnread} size="sm" />,
    content: () => <Rss size={16} />,
  }),
  // GitHub Trending: global (not session-bound) — public data anyone can
  // browse. Defaults right after RSS in the configurable row: another
  // "external feed" panel, so they sit shoulder-to-shoulder. The button and
  // tab-bar glyph is the GitHub Octocat (brand icon), not a generic arrow.
  githubTrending: panelButton("githubTrending", {
    labelKey: "GitHub Trending",
    content: () => <GithubIcon size={16} />,
  }),
  // Cwd-derived (one repo per active session) — treated as session-bound
  // for column layout so it pins with the other "live state" buttons.
  gitDiff: panelButton("gitDiff", {
    labelKey: "Open git diff",
    // Disabled when there's no cwd at all (no selected session, no
    // in-flight new-session cwd) — matches the original inline guard.
    isDisabled: (ctx) => !ctx.selectedCwd,
    content: () => <GitGraph size={16} />,
    commandIcon: <GitGraph size={16} />,
  }),
  favorites: panelButton("favorites", {
    labelKey: "Open favorites",
    // Active state uses fill="var(--accent)" instead of just the color flip,
    // matching the original star and the tab-bar icon.
    content: (ctx) => (
      <Star size={16} fill={ctx.activeTabKind === "favorites" ? "var(--accent)" : "none"} />
    ),
    commandIcon: <Star size={16} />,
  }),
  tokens: panelButton("tokens", {
    labelKey: "Open token audit",
    content: () => <ChartSpline size={16} />,
    commandIcon: <ChartSpline size={16} />,
  }),
  llmAudit: panelButton("llmAudit", {
    labelKey: "Open LLM API audit",
    content: () => <ChartColumn size={16} />,
    commandIcon: <ChartColumn size={16} />,
  }),
  toolCalls: panelButton("toolCalls", {
    labelKey: "Tool Calls",
    content: (ctx) => {
      const { runningCount, totalCount } = ctx.toolStats;
      const badgeColor =
        runningCount > 0
          ? "var(--accent)"
          : totalCount > 0
            ? "var(--text-muted)"
            : null;
      return (
        <>
          <Wrench size={16} />
          {badgeColor !== null && (
            <span
              style={{
                fontSize: 9,
                lineHeight: "10px",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: badgeColor,
              }}
            >
              {runningCount > 0 ? `${runningCount}/${totalCount}` : totalCount}
            </span>
          )}
        </>
      );
    },
    commandIcon: <Wrench size={16} />,
    bodyLayout: { flexDirection: "column", gap: 1 },
  }),
  conversationTree: panelButton("conversationTree", {
    labelKey: "Open conversation tree",
    isDisabled: (ctx) => !ctx.selectedSessionId && !ctx.selectedCwd,
    content: () => <GitBranch size={16} />,
  }),
  // BTW (By the way): session-bound, reads from the active main session.
  // Disabled when there's no stable sessionId yet. The button shows the
  // animated speech-bubble-with-dots glyph so the user can spot it without
  // reading, while the tooltip keeps the "Open BTW" label (an i18n key,
  // never inlined into the glyph).
  btw: panelButton("btw", {
    labelKey: "Open BTW",
    isDisabled: (ctx) => !ctx.selectedSessionId,
    content: () => <MessageSquareMore size={16} />,
  }),
  // Kanban: global board (spans all cwds), not session-bound. Its spec
  // declares an expanded default open state so the four columns have room,
  // while a second click collapses the panel like any other toggle button.
  kanban: panelButton("kanban", {
    labelKey: "Kanban",
    content: () => <SquareKanban size={16} />,
  }),
  // Notes: global personal note-taking board, not session-bound. It stores
  // plain markdown under ~/.pi-work/user-notes and is intended for the human
  // user (the agent stays out of it).
  notes: panelButton("notes", {
    labelKey: "Notes",
    content: () => <NotebookText size={16} />,
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

/** Command-palette icon per panel kind, from the same presentation entries
 *  the right-bar column uses. Reads the descriptor so an icon is declared
 *  exactly once. */
export const PANEL_COMMAND_ICON_BY_KIND: Partial<Record<PanelViewKind, ReactNode>> =
  Object.fromEntries(
    PANEL_TAB_KINDS.flatMap((kind) => {
      const icon = PANEL_DESCRIPTOR_BY_KIND[kind].commandIcon;
      return icon ? [[kind, icon] as const] : [];
    }),
  );

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
