import {
  CHANNELS_TAB_ID,
  CONTEXT_TAB_ID,
  CONVERSATION_TREE_TAB_ID,
  FAVORITES_TAB_ID,
  GIT_DIFF_TAB_ID,
  LLM_AUDIT_TAB_ID,
  MCP_TAB_ID,
  MODELS_CONFIG_TAB_ID,
  SCHEDULER_TAB_ID,
  SKILLS_TAB_ID,
  TOKENS_TAB_ID,
  TRANSLATE_TAB_ID,
} from "./types";

export interface PanelTabParams {
  favorites: undefined;
  translate: undefined;
  tokens: undefined;
  gitDiff: undefined;
  conversationTree: undefined;
  llmAudit: undefined;
  context: undefined;
  modelsConfig: undefined;
  mcp: undefined;
  skills: undefined;
  scheduler: undefined;
  channels: undefined;
  file: { path: string };
}

export type PanelTabKind = keyof PanelTabParams;
export type PanelViewKind = Exclude<PanelTabKind, "file">;
export type LabelKeyOf<K extends PanelTabKind> = K extends "file" ? null : string;

export type PanelMode = "closed" | "normal" | "expanded";
export interface PanelTab<K extends PanelTabKind = PanelTabKind> {
  id: string;
  kind: K;
  labelKey: LabelKeyOf<K>;
  params: PanelTabParams[K];
  openCount: number;
  label?: string;
}

export type AnyPanelTab = { [K in PanelTabKind]: PanelTab<K> }[PanelTabKind];

export interface PanelTabsState {
  tabs: AnyPanelTab[];
  activeId: string | null;
  mode: PanelMode;
}

export type PanelTabsAction =
  | { type: "open"; kind: PanelViewKind; params?: PanelTabParams[PanelViewKind] }
  | { type: "open_file"; path: string; label: string }
  | { type: "activate"; id: string }
  | { type: "toggle"; kind: PanelViewKind }
  | { type: "close"; id: string }
  | { type: "close_left"; id: string }
  | { type: "close_right"; id: string }
  | { type: "close_others"; id: string }
  | { type: "close_files_under"; path: string }
  | { type: "set_mode"; mode: PanelMode };

export function createPanelTabsState(): PanelTabsState {
  return { tabs: [], activeId: null, mode: "closed" };
}

export function fileTabId(path: string): string {
  return `file:${path}`;
}

export interface PanelTabCommand {
  labelKey: string;
  keywords: readonly string[];
  id?: string;
}

export interface PanelTabSpec<K extends PanelViewKind = PanelViewKind> {
  kind: K;
  tabId: string;
  labelKey: string;
  defaultMode: Exclude<PanelMode, "closed">;
  sessionBound: boolean;
  commands?: readonly PanelTabCommand[];
}

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
    commands: [
      {
        labelKey: "Open translate",
        keywords: ["translate", "translation", "翻译"],
      },
    ],
  },
  gitDiff: {
    kind: "gitDiff",
    tabId: GIT_DIFF_TAB_ID,
    labelKey: "Git Diff",
    defaultMode: "normal",
    sessionBound: true,
    commands: [
      {
        labelKey: "Open git diff",
        keywords: ["git", "diff", "changes", "status", "变更", "改动", "差异"],
      },
    ],
  },
  favorites: {
    kind: "favorites",
    tabId: FAVORITES_TAB_ID,
    labelKey: "Favorites",
    defaultMode: "normal",
    sessionBound: false,
    commands: [
      {
        labelKey: "Open favorites",
        keywords: ["favorite", "star", "collection", "收藏", "星标"],
      },
    ],
  },
  tokens: {
    kind: "tokens",
    tabId: TOKENS_TAB_ID,
    labelKey: "Token audit",
    defaultMode: "normal",
    sessionBound: false,
    commands: [
      {
        labelKey: "Open token audit",
        keywords: ["tokens", "token", "usage", "audit", "cost", "用量", "审计", "Token"],
      },
    ],
  },
  llmAudit: {
    kind: "llmAudit",
    tabId: LLM_AUDIT_TAB_ID,
    labelKey: "LLM API audit",
    defaultMode: "normal",
    sessionBound: true,
    commands: [
      {
        labelKey: "Open LLM API audit",
        keywords: ["llm", "api", "audit", "request", "response", "调用", "审计", "请求", "响应"],
      },
    ],
  },
  modelsConfig: {
    kind: "modelsConfig",
    tabId: MODELS_CONFIG_TAB_ID,
    labelKey: "Models config",
    defaultMode: "normal",
    sessionBound: false,
    commands: [
      {
        labelKey: "Open models config",
        keywords: ["models", "config", "providers", "api", "模型", "配置", "服务商"],
      },
    ],
  },
  mcp: {
    kind: "mcp",
    tabId: MCP_TAB_ID,
    labelKey: "mcp.title",
    defaultMode: "normal",
    sessionBound: true,
    commands: [
      {
        labelKey: "mcp.open",
        keywords: ["mcp", "servers", "model context protocol", "tools", "服务器", "工具"],
      },
    ],
  },
  skills: {
    kind: "skills",
    tabId: SKILLS_TAB_ID,
    labelKey: "Skills",
    defaultMode: "normal",
    sessionBound: true,
    commands: [
      {
        labelKey: "Open skills",
        keywords: ["skills", "extensions", "skill", "技能", "扩展"],
      },
    ],
  },
  scheduler: {
    kind: "scheduler",
    tabId: SCHEDULER_TAB_ID,
    labelKey: "Scheduled tasks",
    defaultMode: "normal",
    sessionBound: false,
    commands: [
      {
        labelKey: "Open scheduled tasks",
        keywords: ["scheduler", "cron", "timer", "tasks", "schedule", "定时", "任务", "定时任务"],
      },
    ],
  },
  channels: {
    kind: "channels",
    tabId: CHANNELS_TAB_ID,
    labelKey: "Channels",
    defaultMode: "normal",
    sessionBound: false,
    commands: [
      {
        labelKey: "Open channels",
        keywords: ["channels", "wechat", "weixin", "im", "platform", "微信", "频道", "消息"],
      },
    ],
  },
  conversationTree: {
    kind: "conversationTree",
    tabId: CONVERSATION_TREE_TAB_ID,
    labelKey: "Conversation Tree",
    defaultMode: "normal",
    sessionBound: true,
  },
} as const satisfies { [K in PanelViewKind]: PanelTabSpec<K> };

export type RightBarButtonId = keyof typeof PANEL_TAB_SPEC_BY_KIND;

export const PANEL_TAB_SPECS: readonly PanelTabSpec[] = Object.values(PANEL_TAB_SPEC_BY_KIND);

export const PANEL_TAB_KINDS: readonly PanelViewKind[] = PANEL_TAB_SPECS.map((spec) => spec.kind);

const MODE_RANK: Record<PanelMode, number> = { closed: 0, normal: 1, expanded: 2 };

function upgradeMode(current: PanelMode, target: Exclude<PanelMode, "closed">): PanelMode {
  return MODE_RANK[target] > MODE_RANK[current] ? target : current;
}

function createPanelTab<K extends PanelViewKind>(
  kind: K,
  params?: PanelTabParams[K],
): AnyPanelTab {
  const spec = PANEL_TAB_SPEC_BY_KIND[kind];
  return {
    id: spec.tabId,
    kind,
    labelKey: spec.labelKey,
    params,
    openCount: 1,
  } as AnyPanelTab;
}

function keepActive(
  activeId: string | null,
  tabs: readonly AnyPanelTab[],
  fallbackId: string,
): string | null {
  if (activeId === null) return null;
  return tabs.some((tab) => tab.id === activeId) ? activeId : fallbackId;
}

function bumpOpenCount(tabs: readonly AnyPanelTab[], id: string): AnyPanelTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, openCount: tab.openCount + 1 } : tab));
}

function isPathAtOrUnder(path: string, deleted: string): boolean {
  return (
    path === deleted ||
    path.startsWith(deleted + "/") ||
    path.startsWith(deleted + "\\")
  );
}

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
            } satisfies AnyPanelTab,
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

    case "close_files_under": {
      const tabs = state.tabs.filter(
        (tab) => !(tab.kind === "file" && isPathAtOrUnder(tab.params.path, action.path)),
      );
      if (tabs.length === state.tabs.length) return state;
      if (tabs.length === 0) return { tabs, activeId: null, mode: "closed" };
      if (tabs.some((tab) => tab.id === state.activeId)) return { ...state, tabs };
      return { tabs, activeId: tabs[tabs.length - 1].id, mode: state.mode };
    }

    case "set_mode":
      return { ...state, mode: action.mode };
  }
}

export function selectTab(state: PanelTabsState, id: string): AnyPanelTab | null {
  return state.tabs.find((tab) => tab.id === id) ?? null;
}

export function selectActiveTab(state: PanelTabsState): AnyPanelTab | null {
  return state.activeId === null ? null : selectTab(state, state.activeId);
}

export function selectTabByKind(state: PanelTabsState, kind: PanelViewKind): AnyPanelTab | null {
  return state.tabs.find((tab) => tab.kind === kind) ?? null;
}

export function selectOpenCount(state: PanelTabsState, kind: PanelViewKind): number {
  return selectTabByKind(state, kind)?.openCount ?? 0;
}

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

export function selectCanExpand(state: PanelTabsState): boolean {
  return selectIsOpen(state) && selectHasTabs(state);
}

export const PANEL_BUTTON_ID_BY_KIND: Record<PanelViewKind, RightBarButtonId> =
  Object.fromEntries(
    Object.entries(PANEL_TAB_SPEC_BY_KIND).map(([buttonId, spec]) => [
      spec.kind,
      buttonId,
    ]),
  ) as Record<PanelViewKind, RightBarButtonId>;

export function panelButtonIdForKind(kind: PanelTabKind): RightBarButtonId | null {
  return kind === "file" ? null : PANEL_BUTTON_ID_BY_KIND[kind];
}
