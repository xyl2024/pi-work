export type SettingsGroupId = "personal" | "appearance" | "agent" | "integrations" | "developer";

export interface SettingsGroupSpec {
  id: SettingsGroupId;
  labelKey: string;
  developer?: boolean;
}

export type SettingsSectionId =
  | "profile"
  | "right-bar"
  | "ui-sounds"
  | "file-preview"
  | "append-system"
  | "dangerous-commands"
  | "subagent"
  | "retry"
  | "network-proxy"
  | "toast-test"
  | "about";

export interface SettingsSectionSpec {
  id: SettingsSectionId;
  labelKey: string;
  group: SettingsGroupId;
}

export const SETTINGS_GROUPS: readonly SettingsGroupSpec[] = [
  { id: "personal", labelKey: "Personal" },
  {
    id: "appearance",
    labelKey: "Interface & appearance",
  },
  { id: "agent", labelKey: "Agent" },
  { id: "integrations", labelKey: "Integrations & network" },
  {
    id: "developer",
    labelKey: "Developer",
    developer: true,
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionSpec[] = [
  { id: "profile", labelKey: "Profile", group: "personal" },

  { id: "right-bar", labelKey: "Right-side buttons", group: "appearance" },
  { id: "ui-sounds", labelKey: "UI Sounds", group: "appearance" },
  { id: "file-preview", labelKey: "File preview limits", group: "appearance" },

  { id: "append-system", labelKey: "System Prompt", group: "agent" },
  { id: "dangerous-commands", labelKey: "Dangerous commands", group: "agent" },
  { id: "subagent", labelKey: "Subagent settings", group: "agent" },
  { id: "retry", labelKey: "Agent retry", group: "agent" },

  { id: "network-proxy", labelKey: "Network proxy", group: "integrations" },

  { id: "toast-test", labelKey: "Toast Test", group: "developer" },
  { id: "about", labelKey: "About Pi Work", group: "developer" },
];

export function sectionsForGroup(group: SettingsGroupId): SettingsSectionSpec[] {
  return SETTINGS_SECTIONS.filter((section) => section.group === group);
}

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] =
  SETTINGS_GROUPS.flatMap((group) => sectionsForGroup(group.id).map((section) => section.id));

export const DEFAULT_SETTINGS_SECTION_ID: SettingsSectionId = "profile";

const SETTINGS_SECTION_ID_SET: ReadonlySet<string> = new Set(SETTINGS_SECTION_IDS);

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTION_ID_SET.has(value);
}

export function groupForSection(id: SettingsSectionId): SettingsGroupSpec {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id);
  const groupId = section?.group;
  const group = SETTINGS_GROUPS.find((g) => g.id === groupId);
  if (!group) throw new Error(`settings registry: section ${id} has no group`);
  return group;
}