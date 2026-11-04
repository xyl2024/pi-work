import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeSkillsForm,
  openSkillsForm,
  selectSkill,
  setSkillsQuery,
  skillsPanel,
} from "@/lib/client/skills-panel";
import { requestMainViewLeave, setMainViewLeaveConfirm } from "@/lib/client/main-view-leave";
import {
  MAIN_VIEW_LEAVE_CONFIRM,
  type MainViewLeaveConfirm,
} from "@/lib/shared/main-view-leave";

const BROWSE = { kind: "browse" };
const FORM = { kind: "form" };

function patchRunningInstall(logs: string[] = []): void {
  skillsPanel.patch({
    install: {
      phase: "running",
      request: { package: "owner/repo@skill", scope: "global" },
      logs,
      error: null,
      installed: [],
    },
  });
}

beforeEach(() => {
  skillsPanel.release();
  skillsPanel.open(null);
  setMainViewLeaveConfirm(null);
});

afterEach(() => {
  setMainViewLeaveConfirm(null);
});

describe("skills browse selection", () => {
  it("replaces the selected skill in place, without growing the page stack", () => {
    selectSkill("/skills/a/SKILL.md");

    expect(skillsPanel.get().selectedFilePath).toBe("/skills/a/SKILL.md");
    expect(skillsPanel.pages()).toEqual([BROWSE]);

    selectSkill("/skills/b/SKILL.md");

    expect(skillsPanel.get().selectedFilePath).toBe("/skills/b/SKILL.md");
    expect(skillsPanel.pages()).toEqual([BROWSE]);
  });

  it("keeps the search term while the form opens and closes", async () => {
    setSkillsQuery("deploy");

    await openSkillsForm();
    expect(skillsPanel.currentPage()).toEqual(FORM);

    await closeSkillsForm();

    expect(skillsPanel.currentPage()).toEqual(BROWSE);
    expect(skillsPanel.get().query).toBe("deploy");
  });

  it("keeps the page stack down to browse and form", async () => {
    selectSkill("/skills/a/SKILL.md");
    await openSkillsForm();

    expect(skillsPanel.pageDepth()).toBe(2);
    expect(skillsPanel.pages()).toEqual([BROWSE, FORM]);
  });
});

describe("skills leave guard", () => {
  it("lets the leave through silently when no install is running", async () => {
    const asked: MainViewLeaveConfirm[] = [];
    setMainViewLeaveConfirm((confirm) => {
      asked.push(confirm);
      return true;
    });

    expect(await requestMainViewLeave({ view: "skills", intent: "leave_main_view" })).toBe(true);
    expect(asked).toEqual([]);
  });

  it("opens the install form mid-install without a leave confirmation", async () => {
    patchRunningInstall();
    const asked: MainViewLeaveConfirm[] = [];
    setMainViewLeaveConfirm((confirm) => {
      asked.push(confirm);
      return true;
    });

    expect(await openSkillsForm()).toBe(true);
    expect(asked).toEqual([]);
    expect(skillsPanel.currentPage()).toEqual(FORM);
  });

  it("asks once while an install is running", async () => {
    patchRunningInstall();
    const asked: MainViewLeaveConfirm[] = [];
    setMainViewLeaveConfirm((confirm) => {
      asked.push(confirm);
      return true;
    });

    expect(await requestMainViewLeave({ view: "skills", intent: "switch_main_view" })).toBe(true);
    expect(asked).toEqual([MAIN_VIEW_LEAVE_CONFIRM]);
  });

  it("keeps the install running with its log after the leave is confirmed", async () => {
    patchRunningInstall(["installing…"]);
    setMainViewLeaveConfirm(() => true);

    expect(await requestMainViewLeave({ view: "skills", intent: "leave_main_view" })).toBe(true);
    expect(skillsPanel.get().install.phase).toBe("running");
    expect(skillsPanel.get().install.logs).toEqual(["installing…"]);
  });

  it("stops the leave when the confirmation is declined", async () => {
    patchRunningInstall();
    setMainViewLeaveConfirm(() => false);

    expect(await requestMainViewLeave({ view: "skills", intent: "leave_main_view" })).toBe(false);
  });

  it("never asks when a secondary page goes back inside the view", async () => {
    await openSkillsForm();
    patchRunningInstall();
    const asked: MainViewLeaveConfirm[] = [];
    setMainViewLeaveConfirm((confirm) => {
      asked.push(confirm);
      return true;
    });

    expect(await requestMainViewLeave({ view: "skills", intent: "back_to_browse" })).toBe(true);
    expect(asked).toEqual([]);
    expect(skillsPanel.currentPage()).toEqual(FORM);
  });
});

describe("skills working-directory bucket", () => {
  it("resets the page stack and the selection when the cwd changes", async () => {
    selectSkill("/skills/a/SKILL.md");
    await openSkillsForm();

    skillsPanel.open("/repo/other");

    expect(skillsPanel.pages()).toEqual([BROWSE]);
    expect(skillsPanel.get().selectedFilePath).toBeNull();
  });
});
