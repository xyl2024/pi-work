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

export type SettingsSaveTier = "staged" | "immediate";

const TIER_BY_SHAPE: Record<SettingsInputShape, SettingsSaveTier> = {
  text: "staged",
  secret: "staged",
  textarea: "staged",
  toggle: "immediate",
  select: "immediate",
  radio: "immediate",
  checkbox: "immediate",
  number: "immediate",
  file: "immediate",
};

export function saveTierForShape(shape: SettingsInputShape): SettingsSaveTier {
  return TIER_BY_SHAPE[shape];
}

export function isStagedShape(shape: SettingsInputShape): boolean {
  return TIER_BY_SHAPE[shape] === "staged";
}