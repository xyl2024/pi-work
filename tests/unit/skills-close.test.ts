import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import type { SkillInstallPhase } from "@/lib/shared/skills";
import { SKILLS_INSTALL_CLOSE_CONFIRM, selectSkillsCloseConfirm } from "@/lib/shared/skills-close";

/**
 * The skills panel's close guard (lib/shared/skills-close.ts). One question:
 * would closing the panel tab abandon an install? Driven as plain data — the
 * shell is the only caller and maps the returned i18n keys through `t()`.
 *
 * Unlike the models-config guard there is no second condition to compose: the
 * skills panel holds no draft (enable / disable writes through immediately),
 * so "installing" is the whole rule.
 */

describe("selectSkillsCloseConfirm", () => {
  it("asks before closing while an install is still running", () => {
    expect(selectSkillsCloseConfirm({ installPhase: "running" })).toEqual(
      SKILLS_INSTALL_CLOSE_CONFIRM,
    );
  });

  it("lets the tab close silently when no install has run yet", () => {
    expect(selectSkillsCloseConfirm({ installPhase: "idle" })).toBeNull();
  });

  it("lets the tab close silently after a completed install", () => {
    expect(selectSkillsCloseConfirm({ installPhase: "done" })).toBeNull();
  });

  it("lets the tab close silently after a failed install", () => {
    expect(selectSkillsCloseConfirm({ installPhase: "error" })).toBeNull();
  });

  it("only ever guards the running phase", () => {
    const phases: SkillInstallPhase[] = ["idle", "running", "done", "error"];
    const guarded = phases.filter(
      (installPhase) => selectSkillsCloseConfirm({ installPhase }) !== null,
    );

    expect(guarded).toEqual(["running"]);
  });

  it("labels the close button Close — nothing is being discarded", () => {
    expect(SKILLS_INSTALL_CLOSE_CONFIRM.confirmLabelKey).toBe("Close");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[SKILLS_INSTALL_CLOSE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[SKILLS_INSTALL_CLOSE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[SKILLS_INSTALL_CLOSE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});
