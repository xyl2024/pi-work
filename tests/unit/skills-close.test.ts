import { describe, expect, it } from "vitest";
import type { SkillInstallPhase } from "@/lib/shared/skills";
import { isSkillInstallRunning } from "@/lib/shared/skills-close";

describe("isSkillInstallRunning", () => {
  it("guards exactly the running phase", () => {
    const phases: SkillInstallPhase[] = ["idle", "running", "done", "error"];
    const guarded = phases.filter(isSkillInstallRunning);

    expect(guarded).toEqual(["running"]);
  });

  it("lets a finished install through silently", () => {
    expect(isSkillInstallRunning("done")).toBe(false);
    expect(isSkillInstallRunning("error")).toBe(false);
  });

  it("lets an idle view through silently", () => {
    expect(isSkillInstallRunning("idle")).toBe(false);
  });
});
