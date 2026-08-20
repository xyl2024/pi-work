// ── Right-bar button column: descriptor registry ────────────────────────
// Single source of truth for every button in the 36×36 column on the right
// edge of AppShell. Adding a new toggle-button is a one-line append to
// RIGHT_BAR_DESCRIPTORS and (only if its id is hidden-able) a matching
// RIGHT_BAR_ID_FOR_TAB_KIND entry in lib/types.ts so the auto-close effect
// knows how to dismiss it when the user hides its button.
//
// Two kinds of descriptors:
//   - 'fixed'      — always visible, not in right_side_bar config, no
//                    user-toggleable hidden state. Panel toggle (top),
//                    expand/collapse (middle, conditional), terminal
//                    (bottom — always pinned by behavior, not by style).
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
  TODO_TAB_ID,
  FAVORITES_TAB_ID,
  TRANSLATE_TAB_ID,
  TOOL_CALLS_TAB_ID,
  JSON_TAB_ID,
  CANVAS_TAB_ID,
  RSS_TAB_ID,
  TOKENS_TAB_ID,
  GIT_DIFF_TAB_ID,
  CONVERSATION_TREE_TAB_ID,
  LLM_AUDIT_TAB_ID,
  CONTEXT_TAB_ID,
} from "@/lib/shared/types";
import type { Tab } from "@/components/ui/TabBar";
import {
  PanelToggleIcon,
  ExpandLeftIcon,
  ExpandRightIcon,
  TodoCheckIcon,
  ContextDocumentIcon,
  PencilIcon,
  TranslateIcon,
  JsonBracesIcon,
  RssIcon,
  GitDiffIcon,
  ConversationTreeIcon,
  StarIconWithFill,
  TokensIcon,
  WrenchIcon,
  TerminalIcon,
  LlmAuditIcon,
} from "./icons";

// Tab kinds the right column toggles. Kept narrow so an accidental
// Tab.kind value surfaces as a type error in the descriptor registry.
export type RightBarTabKind = Extract<
  Tab["kind"],
  | "todo"
  | "canvas"
  | "translate"
  | "toolCalls"
  | "json"
  | "rss"
  | "favorites"
  | "tokens"
  | "gitDiff"
  | "conversationTree"
  | "llmAudit"
  | "context"
>;

export interface RightBarCtx {
  // ── observed state ──
  rightPanelState: "closed" | "normal" | "expanded";
  activeTabKind: Tab["kind"] | null;
  /** True when at least one tab is open in the right panel. Used by the
   *  expand/collapse button to gate itself. */
  hasOpenTabs: boolean;
  selectedSessionId: string | null;
  selectedCwd: string | null;
  terminalOpen: boolean;
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
  toggleRightPanel: () => void;
  /** Standard toggle behavior for tab buttons: if `tabId` is already the
   *  active tab and the panel is open, close the panel; otherwise open
   *  the tab. The descriptor passes the appropriate openTab() so callers
   *  never have to know how each tab is constructed. */
  toggleRightPanelTab: (tabId: string, openTab: () => void) => void;
  setRightPanelState: (s: "closed" | "normal" | "expanded") => void;
  toggleTerminal: () => void;
  openTab: {
    todo: () => void;
    canvas: () => void;
    translate: () => void;
    json: () => void;
    rss: () => void;
    gitDiff: () => void;
    favorites: () => void;
    tokens: () => void;
    toolCalls: () => void;
    conversationTree: () => void;
    llmAudit: () => void;
    context: () => void;
  };
}

export interface RightBarDescriptor {
  /** Identifier; required for 'configurable' descriptors (persisted in
   *  right_side_bar.buttons and order). 'fixed' descriptors use one of
   *  two reserved ids: 'panelToggle' (top, always visible) or 'expand'
   *  (top, conditional). */
  id: RightBarButtonId | "panelToggle" | "expand";
  kind: "fixed" | "configurable";
  /** Visual slot — 'top' renders above the configurable row. Undefined =
   *  inline (renders among the configurable row, in user-configured
   *  order). 'bottom' is unused now that terminal is configurable and
   *  lives in the user-ordered row; kept on the type for legacy slots
   *  registered through this module. */
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
  /** Optional visibility predicate. Defaults to always-true. Used by the
   *  expand button (only when the panel has tabs and is open). */
  isVisible?: (ctx: RightBarCtx) => boolean;
  /** Body of the button — typically an icon node, or icon+label for the
   *  tool-calls button. */
  content: (ctx: RightBarCtx) => ReactNode;
  /** Optional layout override forwarded to RightBarButton. Tool-calls uses
   *  { flexDirection: 'column', gap: 1 } to stack the icon and the
   *  running/total counter. */
  bodyLayout?: { flexDirection?: "row" | "column"; gap?: number };
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
  content: () => PanelToggleIcon(),
  onClick: (ctx) => ctx.toggleRightPanel(),
  // Wrap so we can swap the tooltip when active.
};

// Fixed: expand/collapse button (top group, conditional).
const expandDescriptor: RightBarDescriptor = {
  id: "expand",
  kind: "fixed",
  slot: "top",
  labelKey: "", // resolved at render
  // Only render when the panel is open AND has tabs.
  isVisible: (ctx) => ctx.rightPanelState !== "closed" && ctx.hasOpenTabs,
  isActive: (ctx) => ctx.rightPanelState === "expanded",
  content: (ctx) =>
    (ctx.rightPanelState === "expanded" ? ExpandLeftIcon() : ExpandRightIcon()),
  onClick: (ctx) =>
    ctx.setRightPanelState(
      ctx.rightPanelState === "expanded" ? "normal" : "expanded",
    ),
};

// Configurable: terminal toggle. Lives in the user-ordered row rather
// than a fixed bottom slot so Settings can both hide it and reorder it
// alongside the other panel buttons. (Was fixed/slot=bottom before —
// that made it un-toggleable from the right-side bar settings.)
const terminalDescriptor: RightBarDescriptor = {
  id: "terminal",
  kind: "configurable",
  labelKey: "Terminal", // used by Settings checkbox label
  isActive: (ctx) => ctx.terminalOpen,
  content: () => TerminalIcon(),
  onClick: (ctx) => ctx.toggleTerminal(),
};

// Configurable: panel buttons. Their default order in the Settings list
// is the order they appear here — DESC defaults to this ordering when
// `cfg.order` is undefined.

const todosDescriptor: RightBarDescriptor = {
  id: "todos",
  kind: "configurable",
  labelKey: "Open todos",
  isActive: (ctx) => ctx.activeTabKind === "todo",
  content: () => TodoCheckIcon(),
  onClick: (ctx) => ctx.toggleRightPanelTab(TODO_TAB_ID, ctx.openTab.todo),
};

const canvasDescriptor: RightBarDescriptor = {
  id: "canvas",
  kind: "configurable",
  labelKey: "Open canvas",
  isActive: (ctx) => ctx.activeTabKind === "canvas",
  content: () => PencilIcon(),
  // Canvas widens the panel to "expanded" when activated so the whiteboard
  // gets the full right column. Re-clicking when already expanded falls
  // back to "normal"; matching the previous handleToggleCanvasTab logic.
  onClick: (ctx) => {
    if (
      ctx.activeTabKind === "canvas" &&
      ctx.rightPanelState === "expanded"
    ) {
      ctx.setRightPanelState("normal");
      return;
    }
    ctx.toggleRightPanelTab(CANVAS_TAB_ID, ctx.openTab.canvas);
    ctx.setRightPanelState("expanded");
  },
};

const translateDescriptor: RightBarDescriptor = {
  id: "translate",
  kind: "configurable",
  labelKey: "Open translate",
  isActive: (ctx) => ctx.activeTabKind === "translate",
  content: () => TranslateIcon(),
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(TRANSLATE_TAB_ID, ctx.openTab.translate),
};

const jsonDescriptor: RightBarDescriptor = {
  id: "json",
  kind: "configurable",
  labelKey: "JSON",
  isActive: (ctx) => ctx.activeTabKind === "json",
  content: () => JsonBracesIcon(),
  onClick: (ctx) => ctx.toggleRightPanelTab(JSON_TAB_ID, ctx.openTab.json),
};

const rssDescriptor: RightBarDescriptor = {
  id: "rss",
  kind: "configurable",
  labelKey: "RSS",
  isActive: (ctx) => ctx.activeTabKind === "rss",
  badge: (ctx) => <CountBadge count={ctx.rssUnread} />,
  content: () => RssIcon(),
  onClick: (ctx) => ctx.toggleRightPanelTab(RSS_TAB_ID, ctx.openTab.rss),
};

const gitDiffDescriptor: RightBarDescriptor = {
  id: "gitDiff",
  kind: "configurable",
  // Cwd-derived (one repo per active session) — treated as session-bound
  // for column layout so it pins with the other "live state" buttons.
  sessionBound: true,
  labelKey: "Open git diff",
  isActive: (ctx) => ctx.activeTabKind === "gitDiff",
  // Disabled when there's no cwd at all (no selected session, no
  // in-flight new-session cwd) — matches the original inline guard.
  isDisabled: (ctx) => !ctx.selectedCwd,
  badge: (ctx) => <CountBadge count={ctx.gitChangedCount} />,
  content: () => GitDiffIcon(),
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(GIT_DIFF_TAB_ID, ctx.openTab.gitDiff),
};

const favoritesDescriptor: RightBarDescriptor = {
  id: "favorites",
  kind: "configurable",
  labelKey: "Open favorites",
  isActive: (ctx) => ctx.activeTabKind === "favorites",
  // Active state uses fill="var(--accent)" instead of just the color flip,
  // matching the original SVG.
  content: (ctx) =>
    StarIconWithFill(ctx.activeTabKind === "favorites" ? "var(--accent)" : "none"),
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(FAVORITES_TAB_ID, ctx.openTab.favorites),
};

const tokensDescriptor: RightBarDescriptor = {
  id: "tokens",
  kind: "configurable",
  labelKey: "Open token audit",
  isActive: (ctx) => ctx.activeTabKind === "tokens",
  content: () => TokensIcon(),
  // Mirrors canvasDescriptor: open the tab and widen the panel to
  // "expanded" so the token-audit dashboard gets the full right column
  // (chat flex shrinks to 0). Re-clicking when already expanded falls
  // back to "normal".
  onClick: (ctx) => {
    if (
      ctx.activeTabKind === "tokens" &&
      ctx.rightPanelState === "expanded"
    ) {
      ctx.setRightPanelState("normal");
      return;
    }
    ctx.toggleRightPanelTab(TOKENS_TAB_ID, ctx.openTab.tokens);
    ctx.setRightPanelState("expanded");
  },
};

const llmAuditDescriptor: RightBarDescriptor = {
  id: "llmAudit",
  kind: "configurable",
  sessionBound: true,
  labelKey: "Open LLM API audit",
  isActive: (ctx) => ctx.activeTabKind === "llmAudit",
  content: () => LlmAuditIcon(),
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(LLM_AUDIT_TAB_ID, ctx.openTab.llmAudit),
};

const contextDescriptor: RightBarDescriptor = {
  id: "context",
  kind: "configurable",
  sessionBound: true,
  labelKey: "Context",
  isActive: (ctx) => ctx.activeTabKind === "context",
  content: () => ContextDocumentIcon(),
  onClick: (ctx) => ctx.toggleRightPanelTab(CONTEXT_TAB_ID, ctx.openTab.context),
};

const toolCallsDescriptor: RightBarDescriptor = {
  id: "toolCalls",
  kind: "configurable",
  sessionBound: true,
  labelKey: "Tool Calls",
  isActive: (ctx) => ctx.activeTabKind === "toolCalls",
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
        <WrenchIcon />
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
  bodyLayout: { flexDirection: "column", gap: 1 },
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(TOOL_CALLS_TAB_ID, ctx.openTab.toolCalls),
};

const conversationTreeDescriptor: RightBarDescriptor = {
  id: "conversationTree",
  kind: "configurable",
  sessionBound: true,
  labelKey: "Open conversation tree",
  isActive: (ctx) => ctx.activeTabKind === "conversationTree",
  isDisabled: (ctx) => !ctx.selectedSessionId && !ctx.selectedCwd,
  content: () => ConversationTreeIcon(),
  onClick: (ctx) =>
    ctx.toggleRightPanelTab(
      CONVERSATION_TREE_TAB_ID,
      ctx.openTab.conversationTree,
    ),
};

export const RIGHT_BAR_DESCRIPTORS: readonly RightBarDescriptor[] = [
  // 'fixed' group
  panelToggleDescriptor,
  expandDescriptor,
  terminalDescriptor,
  // 'configurable' group — order here is the implicit default order used
  // when the user hasn't customized `cfg.order`.
  contextDescriptor,
  todosDescriptor,
  canvasDescriptor,
  translateDescriptor,
  jsonDescriptor,
  rssDescriptor,
  gitDiffDescriptor,
  favoritesDescriptor,
  tokensDescriptor,
  llmAuditDescriptor,
  toolCallsDescriptor,
  conversationTreeDescriptor,
] as const;

// Tab.kind → RightBarButtonId reverse lookup lives in `lib/types.ts` as a
// plain object literal — there is intentionally no cycle between this
// descriptor module and `lib/types.ts` (this module depends on lib/types
// for tab id constants, so lib/types cannot depend on this module).

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
 *  Expand; terminal: Hide/Open). */
export function resolveButtonLabel(
  desc: RightBarDescriptor,
  ctx: RightBarCtx,
): string {
  switch (desc.id) {
    case "panelToggle":
      return ctx.t(
        ctx.rightPanelState !== "closed" ? "Hide file panel" : "Show file panel",
      );
    case "expand":
      return ctx.t(
        ctx.rightPanelState === "expanded"
          ? "Collapse panel"
          : "Expand panel",
      );
    case "terminal":
      return ctx.t(ctx.terminalOpen ? "Hide terminal" : "Open terminal");
    default:
      return ctx.t(desc.labelKey);
  }
}
