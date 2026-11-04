import type { PanelMode } from "./panelTabs";

export interface MainViewParams {
  scheduler: undefined;
  modelsConfig: undefined;
  skills: undefined;
}

export type MainViewKind = keyof MainViewParams;

export interface MainViewCommand {
  labelKey: string;
  keywords: readonly string[];
  id?: string;
}

export interface MainViewSpec<K extends MainViewKind = MainViewKind> {
  kind: K;
  navPriority: number;
  labelKey: string;
  backLabelKey: string;
  commands?: readonly MainViewCommand[];
}

export const MAIN_VIEW_SPEC_BY_KIND = {
  scheduler: {
    kind: "scheduler",
    navPriority: 1,
    labelKey: "Scheduled tasks",
    backLabelKey: "Back to chat",
    commands: [
      {
        labelKey: "Open scheduled tasks",
        keywords: ["scheduler", "cron", "timer", "tasks", "schedule", "定时", "任务", "定时任务"],
      },
    ],
  },
  modelsConfig: {
    kind: "modelsConfig",
    navPriority: 2,
    labelKey: "Models config",
    backLabelKey: "Back to chat",
    commands: [
      {
        labelKey: "Open models config",
        keywords: ["models", "config", "providers", "api", "模型", "配置", "服务商"],
      },
    ],
  },
  skills: {
    kind: "skills",
    navPriority: 3,
    labelKey: "Skills",
    backLabelKey: "Back to chat",
    commands: [
      {
        labelKey: "Open skills",
        keywords: ["skills", "skill", "extensions", "技能", "扩展"],
      },
    ],
  },
} as const satisfies { [K in MainViewKind]: MainViewSpec<K> };

export const MAIN_VIEW_SPECS: readonly MainViewSpec[] = Object.values(MAIN_VIEW_SPEC_BY_KIND).sort(
  (a, b) => a.navPriority - b.navPriority,
);

export const MAIN_VIEW_KINDS: readonly MainViewKind[] = MAIN_VIEW_SPECS.map((spec) => spec.kind);

export type MainViewState =
  | { active: "chat" }
  | { active: MainViewKind; returnPanelMode: PanelMode };

export type MainViewAction =
  | { type: "enter"; kind: MainViewKind; panelMode: PanelMode }
  | { type: "back" }
  | { type: "toggle"; kind: MainViewKind; panelMode: PanelMode }
  | { type: "activate_chat" };

export function createMainViewState(): MainViewState {
  return { active: "chat" };
}

export function mainViewReducer(
  state: MainViewState,
  action: MainViewAction,
): MainViewState {
  switch (action.type) {
    case "enter":
      return { active: action.kind, returnPanelMode: action.panelMode };
    case "back":
    case "activate_chat":
      return { active: "chat" };
    case "toggle":
      if (selectToggleExits(state, action.kind)) return { active: "chat" };
      return { active: action.kind, returnPanelMode: action.panelMode };
  }
}

export function selectMainViewKind(state: MainViewState): MainViewKind | null {
  return state.active === "chat" ? null : state.active;
}

export function selectToggleExits(state: MainViewState, kind: MainViewKind): boolean {
  return state.active === kind;
}
