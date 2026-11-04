import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  MAIN_VIEW_LEAVE_CONFIRM,
  selectMainViewLeaveConfirm,
  type MainViewLeaveIntent,
} from "@/lib/shared/main-view-leave";

const SWITCHING_INTENTS: readonly MainViewLeaveIntent[] = [
  "leave_main_view",
  "switch_main_view",
  "select_task",
  "new_task",
];

describe("selectMainViewLeaveConfirm", () => {
  it("lets a clean view go without asking", () => {
    for (const intent of SWITCHING_INTENTS) {
      expect(selectMainViewLeaveConfirm({ intent, dirty: false })).toBeNull();
    }
  });

  it("asks the same confirmation for leaving and for switching to another main view", () => {
    for (const intent of SWITCHING_INTENTS) {
      expect(selectMainViewLeaveConfirm({ intent, dirty: true })).toEqual(MAIN_VIEW_LEAVE_CONFIRM);
    }
  });

  it("never asks when a secondary page goes back inside the view", () => {
    expect(selectMainViewLeaveConfirm({ intent: "back_to_browse", dirty: true })).toBeNull();
  });

  it("labels the confirm button Discard, not Close", () => {
    expect(MAIN_VIEW_LEAVE_CONFIRM.confirmLabelKey).toBe("Discard");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});
