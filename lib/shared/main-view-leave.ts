export type MainViewLeaveIntent =
  | "leave_main_view"
  | "switch_main_view"
  | "back_to_browse"
  | "select_task"
  | "new_task";

export interface MainViewLeaveConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
  params?: Record<string, string | number>;
}

export const MAIN_VIEW_LEAVE_CONFIRM: MainViewLeaveConfirm = {
  titleKey: "Leave while work is in progress?",
  descriptionKey:
    "Unsaved changes will be lost. Work in progress will either stop or keep running in the background.",
  confirmLabelKey: "Leave",
};

export const MAIN_VIEW_LEAVE_CONFIRM_WITH_CHANGES: MainViewLeaveConfirm = {
  ...MAIN_VIEW_LEAVE_CONFIRM,
  descriptionKey:
    "Discard {n} unsaved changes. Work in progress will either stop or keep running in the background.",
};

export const SWITCHING_INTENTS: ReadonlySet<MainViewLeaveIntent> = new Set([
  "leave_main_view",
  "switch_main_view",
  "select_task",
  "new_task",
]);

export function selectMainViewLeaveConfirm(conditions: {
  intent: MainViewLeaveIntent;
  dirty: boolean;
  changeCount?: number;
}): MainViewLeaveConfirm | null {
  if (!conditions.dirty) return null;
  if (!SWITCHING_INTENTS.has(conditions.intent)) return null;
  const count = conditions.changeCount ?? 0;
  if (count <= 0) return MAIN_VIEW_LEAVE_CONFIRM;
  return { ...MAIN_VIEW_LEAVE_CONFIRM_WITH_CHANGES, params: { n: count } };
}
