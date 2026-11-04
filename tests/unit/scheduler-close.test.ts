import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  SCHEDULER_DIRTY_CLOSE_CONFIRM,
  isSchedulerFormDirty,
  selectSchedulerLeaveConfirm,
  type SchedulerLeaveIntent,
} from "@/lib/shared/scheduler-close";
import { EMPTY_SCHEDULER_FORM, newSchedulerForm } from "@/lib/shared/scheduler-form";

const LEAVE_INTENTS: readonly SchedulerLeaveIntent[] = [
  "back_to_browse",
  "select_task",
  "new_task",
  "leave_main_view",
];

describe("selectSchedulerLeaveConfirm", () => {
  it("lets every exit through silently when the form is clean", () => {
    for (const intent of LEAVE_INTENTS) {
      expect(selectSchedulerLeaveConfirm({ intent, dirty: false })).toBeNull();
    }
  });

  it("asks the same single confirmation for every exit while the form is dirty", () => {
    for (const intent of LEAVE_INTENTS) {
      expect(selectSchedulerLeaveConfirm({ intent, dirty: true })).toEqual(SCHEDULER_DIRTY_CLOSE_CONFIRM);
    }
  });

  it("labels the confirm button Discard, not Close", () => {
    expect(SCHEDULER_DIRTY_CLOSE_CONFIRM.confirmLabelKey).toBe("Discard");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[SCHEDULER_DIRTY_CLOSE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[SCHEDULER_DIRTY_CLOSE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[SCHEDULER_DIRTY_CLOSE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});

describe("isSchedulerFormDirty", () => {
  it("is false when there is no form", () => {
    expect(isSchedulerFormDirty(null, null)).toBe(false);
    expect(isSchedulerFormDirty(EMPTY_SCHEDULER_FORM, null)).toBe(false);
  });

  it("is false for a blank form that was just opened", () => {
    const form = newSchedulerForm("/repo");
    expect(isSchedulerFormDirty(form, { ...form })).toBe(false);
  });

  it("is true after any field changes", () => {
    const baseline = newSchedulerForm("/repo");
    expect(isSchedulerFormDirty({ ...baseline, name: "daily" }, baseline)).toBe(true);
    expect(isSchedulerFormDirty({ ...baseline, cron: "0 8 * * *" }, baseline)).toBe(true);
    expect(isSchedulerFormDirty({ ...baseline, notifyEnabled: true }, baseline)).toBe(true);
  });

  it("compares list fields by content", () => {
    const baseline = newSchedulerForm("/repo");
    expect(isSchedulerFormDirty({ ...baseline, toolSelection: ["Read"] }, baseline)).toBe(true);
    expect(
      isSchedulerFormDirty(
        { ...baseline, toolSelection: ["Read", "Bash"] },
        { ...baseline, toolSelection: ["Read", "Bash"] },
      ),
    ).toBe(false);
  });
});
