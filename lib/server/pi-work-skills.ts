import { loadSkillsFromDir, type LoadSkillsResult } from "@earendil-works/pi-coding-agent";
import { dataPath } from "./data-dir";

/**
 * Pi Work–owned skills, stored in `<dataDir>/skills/` (default
 * `~/.pi-work/skills/`). This directory is separate from pi's own skill
 * directories (`~/.pi/agent/skills/` global scope and `<cwd>/.pi/skills/`
 * project scope): pi's DefaultResourceLoader does not scan it, so Pi Work
 * discovers it explicitly and merges the result wherever pi's skill list is
 * consumed (the /api/skills modal and the rpc-manager skillsOverride).
 *
 * Uses the SDK's `loadSkillsFromDir`, so discovery/likely validation follow
 * the same rules as pi's builtin skill dirs (SKILL.md roots, direct .md
 * children, recursive subdirectory scan). `source: "pi-work"` marks the
 * resulting skills for the UI's dedicated "Pi Work" group.
 */
export function loadPiWorkSkills(): LoadSkillsResult {
  return loadSkillsFromDir({ dir: dataPath("skills"), source: "pi-work" });
}

/** Defensive variant for hot paths (session start, skillsOverride): never
 *  throws — a missing or unreadable `<dataDir>/skills/` just yields no skills. */
export function loadPiWorkSkillsSafety(): LoadSkillsResult["skills"] {
  try {
    return loadPiWorkSkills().skills;
  } catch {
    return [];
  }
}
