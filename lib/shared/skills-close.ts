import type { SkillInstallPhase } from "./skills";

export function isSkillInstallRunning(phase: SkillInstallPhase): boolean {
  return phase === "running";
}
