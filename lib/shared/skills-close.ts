import type { SkillInstallPhase } from "./skills";

export interface SkillsCloseConditions {
  installPhase: SkillInstallPhase;
}

export interface SkillsCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

export const SKILLS_INSTALL_CLOSE_CONFIRM: SkillsCloseConfirm = {
  titleKey: "Close while installing?",
  descriptionKey: "The installation keeps running in the background, but its log will be lost.",
  confirmLabelKey: "Close",
};

export function selectSkillsCloseConfirm(
  conditions: SkillsCloseConditions,
): SkillsCloseConfirm | null {
  return conditions.installPhase === "running" ? SKILLS_INSTALL_CLOSE_CONFIRM : null;
}
