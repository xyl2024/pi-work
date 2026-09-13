// ── Panel tab strip: identity registry + pure state machine ──────────────
// The panel tab strip owns the whole of the right panel's open/close
// behaviour: which panel views are open, which one is active, and whether the
// panel itself is closed / normal / expanded. Everything in this module is
// pure and lives in the shared layer — no React, no DOM, no server imports —
// so its rules are unit-testable without a browser.
//
// Two halves:
//   • PANEL_TAB_SPEC_BY_KIND — panel identity: kind, tab id, label key,
//     default mode, session binding and the optional command-palette entry.
//     This is the single source of truth for "what a panel view is".
//   • panelTabsReducer + selectors — the strip's state machine. Label text is
//     resolved at render time from `labelKey`, so open tabs follow a locale
//     switch; each tab carries an `openCount` so a re-open can be observed by
//     panels that need to refresh (git diff) or focus (BTW).
//
// Presentation (icon and panel body) deliberately stays outside this module:
// the right-bar descriptors look a body up by kind. Adding a panel view is two
// registrations — one spec here, one presentation entry there.
//
// The compatibility adapter at the bottom maps the new state onto the shapes
// the shell uses today (`Tab[]` + the right-bar context fields), so the UI can
// be migrated to this state machine in slices without a big-bang rewrite.

import type { RightBarButtonId } from "./right-bar";
import {
  BTW_TAB_ID,
  CONTEXT_TAB_ID,
  CONVERSATION_TREE_TAB_ID,
  FAVORITES_TAB_ID,
  GIT_DIFF_TAB_ID,
  GITHUB_TRENDING_TAB_ID,
  KANBAN_TAB_ID,
  LLM_AUDIT_TAB_ID,
  NOTES_TAB_ID,
  RSS_TAB_ID,
  TOKENS_TAB_ID,
  TOOL_CALLS_TAB_ID,
  TRANSLATE_TAB_ID,
} from "./types";

// ── Kinds & per-kind payloads ────────────────────────────────────────────

/**
 * Kind → payload map for everything that can live in the strip. Panel views
 * carry no payload yet (so their entry is `undefined`); adding one later is a
 * single map entry, and the type of `PanelTab.params` follows automatically.
 * `file` is the file-preview tab: a viewer for one path, not a panel view.
 */
export interface PanelTabParams {
  favorites: undefined;
  translate: undefined;
  toolCalls: undefined;
  rss: undefined;
  tokens: undefined;
  gitDiff: undefined;
  conversationTree: undefined;
  llmAudit: undefined;
  context: undefined;
  btw: undefined;
  githubTrending: undefined;
  kanban: undefined;
  notes: undefined;
  file: { path: string };
}

/** Everything the strip can show. */
export type PanelTabKind = keyof PanelTabParams;
/** The panel views proper — everything except the file preview. */
export type PanelViewKind = Exclude<PanelTabKind, "file">;
/** Panel views label themselves through `t(labelKey)`; file tabs carry a name. */
export type LabelKeyOf<K extends PanelTabKind> = K extends "file" ? null : string;

/** The panel's own open state. Only `open` upgrades it, `set_mode` can lower it. */
export type PanelMode = "closed" | "normal" | "expanded";
/** Mirrors the shell's layout mode (agentic / classic) for expand-button rules. */
export type PanelLayoutMode = "agentic" | "classic";

export interface PanelTab<K extends PanelTabKind = PanelTabKind> {
  /** Stable strip identity. A panel view reuses its tab id on every open. */
  id: string;
  kind: K;
  /** i18n key resolved when the strip renders — never a baked-in label. */
  labelKey: LabelKeyOf<K>;
  params: PanelTabParams[K];
  /** Incremented on every open, including re-opens of an existing tab. */
  openCount: number;
  /** Display name — only file preview tabs carry one. */
  label?: string;
}

export interface PanelTabsState {
  /** Open tabs, newest first — the order the strip renders them in. */
  tabs: PanelTab[];
  activeId: string | null;
  mode: PanelMode;
}

export type PanelTabsAction =
  // Existing tab is reused; mode only upgrades; openCount++
  | { type: "open"; kind: PanelViewKind; params?: PanelTabParams[PanelViewKind] }
  | { type: "open_file"; path: string; label: string }
  | { type: "activate"; id: string }
  // Active and open → collapse the panel; otherwise behaves like `open`
  | { type: "toggle"; kind: PanelViewKind }
  | { type: "close"; id: string }
  | { type: "close_left"; id: string }
  | { type: "close_right"; id: string }
  | { type: "close_others"; id: string }
  | { type: "set_mode"; mode: PanelMode };

export function createPanelTabsState(): PanelTabsState {
  return { tabs: [], activeId: null, mode: "closed" };
}

/** Strip id of a file preview tab. Matches the id the shell has always used. */
export function fileTabId(path: string): string {
  return `file:${path}`;
}

// ── Identity registry ────────────────────────────────────────────────────

export interface PanelTabCommand {
  /** i18n key for the command-palette entry. */
  labelKey: string;
  /** Palette search keywords (english + chinese, matching the palette). */
  keywords: readonly string[];
}

export interface PanelTabSpec<K extends PanelViewKind = PanelViewKind> {
  kind: K;
  /** Tab page id — see lib/shared/types.ts for the constants. */
  tabId: string;
  /** i18n key; the strip resolves it on every render. */
  labelKey: string;
  /** Mode `open` upgrades to (never downgrades to). */
  defaultMode: Exclude<PanelMode, "closed">;
  /** True when the panel reads state of the selected session. */
  sessionBound: boolean;
  /** Optional command-palette entry. Panels without one get no palette command. */
  command?: PanelTabCommand;
}

/**
 * Panel view identity, declared once. The object is keyed by
 * `RightBarButtonId`, so a new right-bar button must register its panel
 * identity here and a stray kind cannot sneak in with an unknown button id.
 * Declaration order is also the strip/settings default order, and it matches
 * the ordering of the right-bar descriptor list.
 */
export const PANEL_TAB_SPEC_BY_KIND = {
  context: {
    kind: "context",
    tabId: CONTEXT_TAB_ID,
    labelKey: "Context",
    defaultMode: "normal",
    sessionBound: true,
  },
  translate: {
    kind: "translate",
    tabId: TRANSLATE_TAB_ID,
    labelKey: "Translate",
    defaultMode: "normal",
    sessionBound: false,
    command: {
      labelKey: "Open translate",
      keywords: ["translate", "translation", "翻译"],
    },
  },
  rss: {
    kind: "rss",
    tabId: RSS_TAB_ID,
    labelKey: "RSS",
    defaultMode: "normal",
    sessionBound: false,
  },
  githubTrending: {
    kind: "githubTrending",
    tabId: GITHUB_TRENDING_TAB_ID,
    labelKey: "GitHub Trending",
    defaultMode: "normal",
    sessionBound: false,
  },
  gitDiff: {
    kind: "gitDiff",
    tabId: GIT_DIFF_TAB_ID,
    labelKey: "Git Diff",
    defaultMode: "normal",
    sessionBound: true,
    command: {
      labelKey: "Open git diff",
      keywords: ["git", "diff", "changes", "status", "变更", "改动", "差异"],
    },
  },
  favorites: {
    kind: "favorites",
    tabId: FAVORITES_TAB_ID,
    labelKey: "Favorites",
    defaultMode: "normal",
    sessionBound: false,
    command: {
      labelKey: "Open favorites",
      keywords: ["favorite", "star", "collection", "收藏", "星标"],
    },
  },
  tokens: {
    kind: "tokens",
    tabId: TOKENS_TAB_ID,
    labelKey: "Token audit",
    defaultMode: "normal",
    sessionBound: false,
    command: {
      labelKey: "Open token audit",
      keywords: ["tokens", "token", "usage", "audit", "cost", "用量", "审计", "Token"],
    },
  },
  llmAudit: {
    kind: "llmAudit",
    tabId: LLM_AUDIT_TAB_ID,
    labelKey: "LLM API audit",
    defaultMode: "normal",
    sessionBound: true,
    command: {
      labelKey: "Open LLM API audit",
      keywords: ["llm", "api", "audit", "request", "response", "调用", "审计", "请求", "响应"],
    },
  },
  toolCalls: {
    kind: "toolCalls",
    tabId: TOOL_CALLS_TAB_ID,
    labelKey: "Tool Calls",
    defaultMode: "normal",
    sessionBound: true,
    command: {
      labelKey: "Open tool calls",
      keywords: ["tool", "calls", "stats", "工具", "调用", "统计"],
    },
  },
  conversationTree: {
    kind: "conversationTree",
    tabId: CONVERSATION_TREE_TAB_ID,
    labelKey: "Conversation Tree",
    defaultMode: "normal",
    sessionBound: true,
  },
  btw: {
    kind: "btw",
    tabId: BTW_TAB_ID,
    // The strip has always displayed the BTW tab through this key, not "BTW".
    labelKey: "By the way",
    defaultMode: "normal",
    sessionBound: true,
  },
  kanban: {
    kind: "kanban",
    tabId: KANBAN_TAB_ID,
    labelKey: "Kanban",
    // The four-column board needs the full column width.
    defaultMode: "expanded",
    sessionBound: false,
  },
  notes: {
    kind: "notes",
    tabId: NOTES_TAB_ID,
    labelKey: "Notes",
    defaultMode: "normal",
    sessionBound: false,
  },
} as const satisfies Record<RightBarButtonId, PanelTabSpec>;

/** Every panel view spec, in declaration (default) order. */
export const PANEL_TAB_SPECS: readonly PanelTabSpec[] = Object.values(PANEL_TAB_SPEC_BY_KIND);

/** Every panel view kind, in declaration (default) order. */
export const PANEL_TAB_KINDS: readonly PanelViewKind[] = PANEL_TAB_SPECS.map((spec) => spec.kind);

// ── State machine ────────────────────────────────────────────────────────

const MODE_RANK: Record<PanelMode, number> = { closed: 0, normal: 1, expanded: 2 };

/** `open` never lowers the panel: the wider of current and target wins. */
function upgradeMode(current: PanelMode, target: Exclude<PanelMode, "closed">): PanelMode {
  return MODE_RANK[target] > MODE_RANK[current] ? target : current;
}

function createPanelTab<K extends PanelViewKind>(
  kind: K,
  params?: PanelTabParams[K],
): PanelTab {
  const spec = PANEL_TAB_SPEC_BY_KIND[kind];
  return {
    id: spec.tabId,
    kind,
    labelKey: spec.labelKey,
    params,
    openCount: 1,
  };
}

/** Keep `activeId` when it survived the cut, otherwise fall back to the ref tab. */
function keepActive(
  activeId: string | null,
  tabs: readonly PanelTab[],
  fallbackId: string,
): string | null {
  if (activeId === null) return null;
  return tabs.some((tab) => tab.id === activeId) ? activeId : fallbackId;
}

/** Count the open on the tab that already had this id (re-opens included). */
function bumpOpenCount(tabs: readonly PanelTab[], id: string): PanelTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, openCount: tab.openCount + 1 } : tab));
}

/**
 * Pure strip reducer. Owns every open/close rule of the panel:
 *   • `open` reuses the tab, activates it, bumps its openCount and only
 *     upgrades the mode;
 *   • `toggle` collapses the panel when its own tab is active and open;
 *   • closing the active tab falls back to the oldest remaining tab (tabs are
 *     stored newest-first, so that is the last element);
 *   • closing the last tab collapses the panel, while the batch closes always
 *     keep the reference tab and therefore never empty the strip.
 */
export function panelTabsReducer(
  state: PanelTabsState,
  action: PanelTabsAction,
): PanelTabsState {
  switch (action.type) {
    case "open": {
      const spec = PANEL_TAB_SPEC_BY_KIND[action.kind];
      const existing = state.tabs.some((tab) => tab.id === spec.tabId);
      const tabs = existing
        ? bumpOpenCount(state.tabs, spec.tabId)
        : [createPanelTab(action.kind, action.params), ...state.tabs];
      return { tabs, activeId: spec.tabId, mode: upgradeMode(state.mode, spec.defaultMode) };
    }

    case "open_file": {
      const id = fileTabId(action.path);
      const existing = state.tabs.some((tab) => tab.id === id);
      const tabs = existing
        ? bumpOpenCount(state.tabs, id)
        : [
            {
              id,
              kind: "file",
              labelKey: null,
              params: { path: action.path },
              label: action.label,
              openCount: 1,
            } satisfies PanelTab,
            ...state.tabs,
          ];
      return { tabs, activeId: id, mode: upgradeMode(state.mode, "normal") };
    }

    case "activate": {
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      return { ...state, activeId: action.id };
    }

    case "toggle": {
      const active = selectActiveTab(state);
      if (active !== null && active.kind === action.kind && state.mode !== "closed") {
        return { ...state, mode: "closed" };
      }
      return panelTabsReducer(state, { type: "open", kind: action.kind });
    }

    case "close": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (tabs.length === 0) return { tabs, activeId: null, mode: "closed" };
      if (state.activeId !== action.id) return { ...state, tabs };
      return { tabs, activeId: tabs[tabs.length - 1].id, mode: state.mode };
    }

    case "close_left": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index <= 0) return state;
      const tabs = state.tabs.slice(index);
      return { ...state, tabs, activeId: keepActive(state.activeId, tabs, action.id) };
    }

    case "close_right": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1 || index === state.tabs.length - 1) return state;
      const tabs = state.tabs.slice(0, index + 1);
      return { ...state, tabs, activeId: keepActive(state.activeId, tabs, action.id) };
    }

    case "close_others": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      return { ...state, tabs: [state.tabs[index]], activeId: action.id };
    }

    case "set_mode":
      return { ...state, mode: action.mode };
  }
}

// ── Selectors ────────────────────────────────────────────────────────────

export function selectTab(state: PanelTabsState, id: string): PanelTab | null {
  return state.tabs.find((tab) => tab.id === id) ?? null;
}

export function selectActiveTab(state: PanelTabsState): PanelTab | null {
  return state.activeId === null ? null : selectTab(state, state.activeId);
}

/** Active strip kind — null while the panel is collapsed. */
export function selectActiveKind(state: PanelTabsState): PanelTabKind | null {
  if (state.mode === "closed") return null;
  return selectActiveTab(state)?.kind ?? null;
}

export function selectIsOpen(state: PanelTabsState): boolean {
  return state.mode !== "closed";
}

export function selectHasTabs(state: PanelTabsState): boolean {
  return state.tabs.length > 0;
}

/**
 * Whether the expand button may be shown, absorbing the two layout rules:
 * Classic shows it whenever the panel is open, Agentic only once the strip
 * has tabs to show.
 */
export function selectCanExpand(state: PanelTabsState, layoutMode: PanelLayoutMode): boolean {
  if (!selectIsOpen(state)) return false;
  return layoutMode === "agentic" ? selectHasTabs(state) : true;
}

// ── Compatibility adapter ────────────────────────────────────────────────
// Shapes the shell uses today. `LegacyPanelTab` structurally matches
// components/ui/TabBar's `Tab`, and the panel fields match the right-bar
// context, so the shell can switch over one slice at a time.

export type LegacyPanelTab =
  | { kind: "file"; id: string; label: string; filePath: string }
  | { kind: PanelViewKind; id: string; label: string };

/** Today's strip shape: labels baked with `t()`, file tabs keeping their path. */
export function toLegacyTabs(
  state: PanelTabsState,
  t: (key: string) => string,
): LegacyPanelTab[] {
  return state.tabs.map((tab): LegacyPanelTab =>
    tab.kind === "file"
      ? {
          kind: "file",
          id: tab.id,
          label: tab.label ?? "",
          filePath: tab.params?.path ?? "",
        }
      : { kind: tab.kind, id: tab.id, label: t(tab.labelKey ?? "") },
  );
}

export interface LegacyPanelState {
  /** Today's name for `mode` in the right-bar context. */
  rightPanelState: PanelMode;
  activeTabKind: PanelTabKind | null;
  hasOpenTabs: boolean;
  activeTabId: string | null;
}

/** Today's panel fields of the right-bar context. */
export function toLegacyPanelState(state: PanelTabsState): LegacyPanelState {
  return {
    rightPanelState: state.mode,
    activeTabKind: selectActiveKind(state),
    hasOpenTabs: selectHasTabs(state),
    activeTabId: state.activeId,
  };
}
