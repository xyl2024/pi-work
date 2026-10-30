import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const SKILLS_ROOT = path.join(process.cwd(), "agent-skills");

describe("agent-skills distribution source", () => {
  it("loads every distributed skill, named after its directory and undiagnosed", () => {
    const dirs = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const { skills, diagnostics } = loadSkillsFromDir({ dir: SKILLS_ROOT, source: "pi-work" });

    expect(dirs.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
    expect(skills.map((skill) => skill.name).sort()).toEqual([...dirs].sort());
  });
});
