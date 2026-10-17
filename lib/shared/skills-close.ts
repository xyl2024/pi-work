/**
 * Close guard for the skills panel view.
 *
 * The panel tab's × lives in the shell's tab strip, but only the panel knows
 * whether closing it would abandon something. This module is that one
 * question, asked the way the models-config guard asks it
 * (`lib/shared/models-config-close.ts`): pass the conditions, get back the
 * confirmation to show, or null when the tab may close without asking.
 *
 * Exactly one condition can make a close lossy — an install still streaming.
 * The skills panel deliberately holds no draft (enable / disable writes
 * through immediately), so `dirty` never enters the picture here even though
 * its sibling has it; see ADR-0014 for why the two panels' save semantics differ.
 *
 * Collapsing the panel and switching tabs both keep the tab, so neither is a
 * close and neither asks. Only the close paths (the strip × and the batch
 * closes) come through here.
 *
 * Pure — no React / DOM / server imports — so the decision is driven from
 * `tests/unit`. The shell maps the returned i18n keys through `t()`; the copy
 * stays out of here for the same reason every other selector returns a key.
 */

import type { SkillInstallPhase } from "./skills";

/** What the close decision reads. */
export interface SkillsCloseConditions {
  /** The install phase the panel would walk away from. */
  installPhase: SkillInstallPhase;
}

/** The confirmation to show before closing the skills tab. */
export interface SkillsCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  /** Button label for "yes, close". Cancel always keeps the tab. */
  confirmLabelKey: string;
}

/**
 * Shown when closing would drop the live install log. The CLI keeps running
 * server-side (the route does not watch the client connection), so the copy
 * promises exactly what is lost: the log, not the install.
 */
export const SKILLS_INSTALL_CLOSE_CONFIRM: SkillsCloseConfirm = {
  titleKey: "Close while installing?",
  descriptionKey: "The installation keeps running in the background, but its log will be lost.",
  confirmLabelKey: "Close",
};

/**
 * The confirmation to show before closing the skills tab, or null when it may
 * close silently. Only a running install makes the close lossy.
 */
export function selectSkillsCloseConfirm(
  conditions: SkillsCloseConditions,
): SkillsCloseConfirm | null {
  return conditions.installPhase === "running" ? SKILLS_INSTALL_CLOSE_CONFIRM : null;
}
