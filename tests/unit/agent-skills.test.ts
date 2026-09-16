import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

/**
 * The distribution source for Pi Work's own agent skills.
 *
 * `agent-skills/` is not loaded by the runtime — a user copies a directory
 * into `~/.pi-work/skills/`, which `lib/server/pi-work-skills` then scans with
 * this same SDK loader (see CONTEXT.md, "技能"). So this is the only place a
 * copy-broken skill is caught before it reaches a user: frontmatter that the
 * Agent Skills spec rejects (bad `name`, missing/oversized `description`)
 * makes `loadSkillsFromDir` drop the skill and emit a diagnostic.
 */
const SKILLS_ROOT = path.join(process.cwd(), "agent-skills");

describe("agent-skills distribution source", () => {
  it("loads every distributed skill, named after its directory and undiagnosed", () => {
    const dirs = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const { skills, diagnostics } = loadSkillsFromDir({ dir: SKILLS_ROOT, source: "pi-work" });

    // Every directory must yield exactly one skill: a diagnostic here means
    // the skill would silently not exist after a user copied it.
    expect(dirs.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
    expect(skills.map((skill) => skill.name).sort()).toEqual([...dirs].sort());
  });
});
