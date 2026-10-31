import { describe, expect, it } from "vitest";
import { filterSkills, type Skill } from "@/lib/shared/skills";

function skill(name: string, description = ""): Skill {
  return {
    name,
    description,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo: {},
  };
}

const SKILLS = [
  skill("code-review", "Review changes since a fixed point"),
  skill("diagnosing-bugs", "Diagnosis loop for hard bugs"),
  skill("grilling", "Grill the user about a plan"),
];

describe("filterSkills", () => {
  it("returns every skill for an empty or blank query", () => {
    expect(filterSkills(SKILLS, "")).toEqual(SKILLS);
    expect(filterSkills(SKILLS, "   ")).toEqual(SKILLS);
  });

  it("matches skill names case-insensitively", () => {
    expect(filterSkills(SKILLS, "REVIEW")).toEqual([SKILLS[0]]);
  });

  it("matches words from the description", () => {
    expect(filterSkills(SKILLS, "plan")).toEqual([SKILLS[2]]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterSkills(SKILLS, "  bugs  ")).toEqual([SKILLS[1]]);
  });

  it("drops skills that match nothing", () => {
    expect(filterSkills(SKILLS, "zzz")).toEqual([]);
  });
});
