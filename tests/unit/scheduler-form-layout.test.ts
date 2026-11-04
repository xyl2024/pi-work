import { describe, expect, it } from "vitest";
import {
  SCHEDULER_FORM_SPLIT_MIN_WIDTH,
  resolveSchedulerFormLayout,
} from "@/lib/shared/scheduler-form-layout";

describe("resolveSchedulerFormLayout", () => {
  it("stays split before the first measurement", () => {
    expect(resolveSchedulerFormLayout(null)).toBe("split");
  });

  it("stacks a narrow form container", () => {
    expect(resolveSchedulerFormLayout(0)).toBe("stacked");
    expect(resolveSchedulerFormLayout(SCHEDULER_FORM_SPLIT_MIN_WIDTH - 1)).toBe("stacked");
  });

  it("splits once the form container reaches the breakpoint", () => {
    expect(resolveSchedulerFormLayout(SCHEDULER_FORM_SPLIT_MIN_WIDTH)).toBe("split");
    expect(resolveSchedulerFormLayout(SCHEDULER_FORM_SPLIT_MIN_WIDTH + 1)).toBe("split");
  });

  it("exports a positive breakpoint", () => {
    expect(SCHEDULER_FORM_SPLIT_MIN_WIDTH).toBeGreaterThan(0);
  });
});
