/**
 * Settings save semantics.
 *
 * Which of the two save tiers a setting belongs to is decided by the *shape*
 * of its control, not by the section it lives in. Free text and secrets are
 * staged (explicit save); toggles, enums, radios, checkboxes and blur-committed
 * numbers are immediate (applied on change). A section may mix both — that is
 * the correct shape, not an exception.
 *
 * This is a lookup table with no React / DOM / server dependencies so it can be
 * driven directly from `tests/unit`.
 */

/** The input shape of a settings control. */
export type SettingsInputShape =
  | "text"
  | "secret"
  | "textarea"
  | "toggle"
  | "select"
  | "radio"
  | "checkbox"
  | "number"
  | "file";

/** Save tier: staged (explicit save) or immediate (applied on change). */
export type SettingsSaveTier = "staged" | "immediate";

const TIER_BY_SHAPE: Record<SettingsInputShape, SettingsSaveTier> = {
  // Free text and secrets: the user must be able to finish typing first.
  text: "staged",
  secret: "staged",
  textarea: "staged",
  // Everything the user can complete in one gesture.
  toggle: "immediate",
  select: "immediate",
  radio: "immediate",
  checkbox: "immediate",
  // Blur / Enter commit — the gesture itself is "I am done filling this in".
  number: "immediate",
  // Avatar upload commits on file pick.
  file: "immediate",
};

/** The save tier for a control shape. */
export function saveTierForShape(shape: SettingsInputShape): SettingsSaveTier {
  return TIER_BY_SHAPE[shape];
}

/** True when the shape is a staged (explicit-save) control. */
export function isStagedShape(shape: SettingsInputShape): boolean {
  return TIER_BY_SHAPE[shape] === "staged";
}