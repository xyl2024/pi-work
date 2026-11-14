import type { IconName } from "@/components/ui/icons";

export type SettingsGroupId = "personal" | "appearance" | "agent" | "integrations" | "developer";

export interface SettingsGroupSpec {
  id: SettingsGroupId;
  labelKey: string;
  developer?: boolean;
}

export type SettingsSectionId =
  | "profile"
  | "appearance"
  | "right-bar"
  | "assistant"
  | "text-selection-toolbar"
  | "ui-sounds"
  | "file-preview"
  | "append-system"
  | "memory"
  | "compaction"
  | "dangerous-commands"
  | "subagent"
  | "retry"
  | "suggested-prompt"
  | "network-proxy"
  | "deepseek-key"
  | "toast-test"
  | "about";

export interface SettingsSectionSpec {
  id: SettingsSectionId;
  labelKey: string;
  group: SettingsGroupId;
  icon: IconName;
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
  { id: "profile", labelKey: "Profile", group: "personal", icon: "user" },

  { id: "appearance", labelKey: "Theme & language", group: "appearance", icon: "palette" },
  { id: "right-bar", labelKey: "Right-side buttons", group: "appearance", icon: "panelRight" },
  { id: "assistant", labelKey: "Assistant", group: "appearance", icon: "sparkle" },
  { id: "text-selection-toolbar", labelKey: "Text selection toolbar", group: "appearance", icon: "edit" },
  { id: "ui-sounds", labelKey: "UI Sounds", group: "appearance", icon: "volume" },
  { id: "file-preview", labelKey: "File preview limits", group: "appearance", icon: "folder" },

  { id: "append-system", labelKey: "System Prompt", group: "agent", icon: "book" },
  { id: "memory", labelKey: "Memory", group: "agent", icon: "canvas" },
  { id: "compaction", labelKey: "Context compaction", group: "agent", icon: "compress" },
  { id: "dangerous-commands", labelKey: "Dangerous commands", group: "agent", icon: "shield" },
  { id: "subagent", labelKey: "Subagent settings", group: "agent", icon: "conversationTree" },
  { id: "retry", labelKey: "Agent retry", group: "agent", icon: "refresh" },
  { id: "suggested-prompt", labelKey: "Suggested prompt", group: "agent", icon: "star" },

  { id: "network-proxy", labelKey: "Network proxy", group: "integrations", icon: "globe" },
  { id: "deepseek-key", labelKey: "DeepSeek API Key", group: "integrations", icon: "key" },

  { id: "toast-test", labelKey: "Toast Test", group: "developer", icon: "notification" },
  { id: "about", labelKey: "About Pi Work", group: "developer", icon: "gear" },
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