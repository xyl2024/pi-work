import { describe, expect, it } from "vitest";
import { isSchedulerFormDirty } from "@/lib/shared/scheduler-close";
import { EMPTY_SCHEDULER_FORM, newSchedulerForm } from "@/lib/shared/scheduler-form";

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
