import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  SCHEDULER_DIRTY_CLOSE_CONFIRM,
  isSchedulerFormDirty,
  selectSchedulerCloseConfirm,
} from "@/lib/shared/scheduler-close";
import { EMPTY_SCHEDULER_FORM, newSchedulerForm } from "@/lib/shared/scheduler-form";

describe("selectSchedulerCloseConfirm", () => {
  it("lets the tab close silently when the form is clean", () => {
    expect(selectSchedulerCloseConfirm({ dirty: false })).toBeNull();
  });

  it("asks before closing while a draft is open", () => {
    expect(selectSchedulerCloseConfirm({ dirty: true })).toEqual(SCHEDULER_DIRTY_CLOSE_CONFIRM);
  });

  it("labels the close button Discard, not Close", () => {
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
