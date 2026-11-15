import { beforeEach, describe, expect, it } from "vitest";
import { selectSkill, skillsPanel } from "@/lib/client/skills-panel";

const BROWSE = { kind: "browse" };

beforeEach(() => {
  skillsPanel.release();
  skillsPanel.open(null);
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
});

describe("skills working-directory bucket", () => {
  it("resets the page stack and the selection when the cwd changes", () => {
    selectSkill("/skills/a/SKILL.md");

    skillsPanel.open("/repo/other");

    expect(skillsPanel.pages()).toEqual([BROWSE]);
    expect(skillsPanel.get().selectedFilePath).toBeNull();
  });
});
