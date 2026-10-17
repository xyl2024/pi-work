import { describe, expect, it } from "vitest";
import { SKILL_GROUP_ORDER, groupSkills, skillGroup, type Skill } from "@/lib/shared/skills";

/**
 * The grid's grouping rule (lib/shared/skills.ts). The panel root page and the
 * retiring modal grid both call `groupSkills`, so this is the contract that
 * keeps them showing the same buckets in the same order.
 */

function skill(name: string, sourceInfo: Skill["sourceInfo"] = {}): Skill {
  return {
    name,
    description: "",
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo,
  };
}

describe("skillGroup", () => {
  it("buckets Pi Work's own skills first", () => {
    expect(skillGroup(skill("a", { source: "pi-work" }))).toBe("pi-work");
    expect(skillGroup(skill("a", { scope: "pi-work" }))).toBe("pi-work");
  });

  it("buckets the user's global skills", () => {
    expect(skillGroup(skill("a", { scope: "user" }))).toBe("global");
    expect(skillGroup(skill("a", { source: "user" }))).toBe("global");
  });

  it("buckets the project's skills", () => {
    expect(skillGroup(skill("a", { scope: "project" }))).toBe("project");
    expect(skillGroup(skill("a", { source: "project" }))).toBe("project");
  });

  it("falls back to path for anything else", () => {
    expect(skillGroup(skill("a"))).toBe("path");
    expect(skillGroup(skill("a", { source: "somewhere-else" }))).toBe("path");
  });
});

describe("groupSkills", () => {
  it("orders groups Pi Work → project → global → path", () => {
    const groups = groupSkills([
      skill("p", { scope: "path" }),
      skill("u", { scope: "user" }),
      skill("j", { scope: "project" }),
      skill("w", { source: "pi-work" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual(["pi-work", "project", "global", "path"]);
    expect(groups.map((group) => group.skills.map((s) => s.name))).toEqual([
      ["w"],
      ["j"],
      ["u"],
      ["p"],
    ]);
  });

  it("drops empty groups", () => {
    const groups = groupSkills([skill("u", { scope: "user" })]);
    expect(groups).toEqual([{ group: "global", skills: [skill("u", { scope: "user" })] }]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupSkills([])).toEqual([]);
  });

  it("keeps the declared order in one place", () => {
    expect(SKILL_GROUP_ORDER).toEqual(["pi-work", "project", "global", "path"]);
  });
});
