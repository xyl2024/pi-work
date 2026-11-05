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
}

export const MAIN_VIEW_LEAVE_CONFIRM: MainViewLeaveConfirm = {
  titleKey: "Leave while work is in progress?",
  descriptionKey:
    "Unsaved changes will be lost. Work in progress will either stop or keep running in the background.",
  confirmLabelKey: "Leave",
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
}): MainViewLeaveConfirm | null {
  if (!conditions.dirty) return null;
  return SWITCHING_INTENTS.has(conditions.intent) ? MAIN_VIEW_LEAVE_CONFIRM : null;
}
