import { loadSkillsFromDir, type LoadSkillsResult } from "@earendil-works/pi-coding-agent";
import { dataPath } from "./data-dir";

export function loadPiWorkSkills(): LoadSkillsResult {
  return loadSkillsFromDir({ dir: dataPath("skills"), source: "pi-work" });
}

export function loadPiWorkSkillsSafety(): LoadSkillsResult["skills"] {
  try {
    return loadPiWorkSkills().skills;
  } catch {
    return [];
  }
}
