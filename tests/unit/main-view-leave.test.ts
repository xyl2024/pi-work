import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  MAIN_VIEW_LEAVE_CONFIRM,
  SWITCHING_INTENTS,
  selectMainViewLeaveConfirm,
} from "@/lib/shared/main-view-leave";

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

  it("labels the confirm button Leave, not Discard or Close", () => {
    expect(MAIN_VIEW_LEAVE_CONFIRM.confirmLabelKey).toBe("Leave");
  });

  it("covers both draft loss and in-flight work in one wording", () => {
    expect(MAIN_VIEW_LEAVE_CONFIRM.titleKey).toBe("Leave while work is in progress?");
    expect(MAIN_VIEW_LEAVE_CONFIRM.descriptionKey).toContain("Unsaved changes will be lost");
    expect(MAIN_VIEW_LEAVE_CONFIRM.descriptionKey).toContain("keep running in the background");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[MAIN_VIEW_LEAVE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});

describe("selectMainViewLeaveConfirm change count", () => {
  it("quantifies the changes that would be discarded", () => {
    const confirm = selectMainViewLeaveConfirm({ intent: "leave_main_view", dirty: true, changeCount: 3 });

    expect(confirm).not.toBeNull();
    expect(confirm?.titleKey).toBe(MAIN_VIEW_LEAVE_CONFIRM.titleKey);
    expect(confirm?.confirmLabelKey).toBe("Leave");
    expect(confirm?.descriptionKey).toContain("{n}");
    expect(confirm?.params).toEqual({ n: 3 });
  });

  it("keeps the generic wording when only a login is running", () => {
    expect(selectMainViewLeaveConfirm({ intent: "leave_main_view", dirty: true, changeCount: 0 }))
      .toEqual(MAIN_VIEW_LEAVE_CONFIRM);
  });

  it("has Chinese copy for the quantified wording", () => {
    const confirm = selectMainViewLeaveConfirm({ intent: "leave_main_view", dirty: true, changeCount: 2 });
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[confirm?.descriptionKey ?? ""]).toContain("{n}");
  });
});
