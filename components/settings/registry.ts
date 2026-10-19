/**
 * Settings registry — the single source of truth for the settings modal's
 * information architecture.
 *
 * Groups and sections are declared together: the sidebar navigation and the
 * modal's page map both derive from this list, in this order, so the two
 * cannot drift. A section must belong to a group and a group must not be
 * empty; `tests/unit/settings-registry.test.ts` pins both, plus "the page map
 * covers exactly the registered sections".
 *
 * No React / DOM dependencies: the invariants are driven directly in tests.
 */

export type SettingsGroupId = "personal" | "appearance" | "agent" | "integrations" | "developer";

export interface SettingsGroupSpec {
  id: SettingsGroupId;
  /** i18n key for the group heading in the sidebar. */
  labelKey: string;
  /** Optional secondary line under the body group heading. */
  descriptionKey?: string;
  /** Developer/debug group: rendered with secondary visual emphasis. */
  developer?: boolean;
}

export type SettingsSectionId =
  | "profile"
  | "right-bar"
  | "ui-sounds"
  | "file-preview"
  | "append-system"
  | "pi-documentation"
  | "subagent"
  | "retry"
  | "network-proxy"
  | "toast-test";

export interface SettingsSectionSpec {
  id: SettingsSectionId;
  /** i18n key for the sidebar entry and the page title. */
  labelKey: string;
  group: SettingsGroupId;
}

/** Group render order == sidebar order. */
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
    descriptionKey: "Debugging helpers. Not needed for normal use.",
    developer: true,
  },
];

/** Section order within (and across) groups, == sidebar order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionSpec[] = [
  { id: "profile", labelKey: "Profile", group: "personal" },

  { id: "right-bar", labelKey: "Right-side buttons", group: "appearance" },
  { id: "ui-sounds", labelKey: "UI Sounds", group: "appearance" },
  { id: "file-preview", labelKey: "File preview limits", group: "appearance" },

  { id: "append-system", labelKey: "Append System Prompt", group: "agent" },
  { id: "pi-documentation", labelKey: "Pi documentation", group: "agent" },
  { id: "subagent", labelKey: "Subagent settings", group: "agent" },
  { id: "retry", labelKey: "Agent retry", group: "agent" },

  { id: "network-proxy", labelKey: "Network proxy", group: "integrations" },

  { id: "toast-test", labelKey: "Toast Test", group: "developer" },
];

/** Sections of one group, in registry order. */
export function sectionsForGroup(group: SettingsGroupId): SettingsSectionSpec[] {
  return SETTINGS_SECTIONS.filter((section) => section.group === group);
}

/**
 * Flat section id list in navigation order — the order the sidebar lists
 * sections and the modal pages through them.
 */
export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] =
  SETTINGS_GROUPS.flatMap((group) => sectionsForGroup(group.id).map((section) => section.id));

/** The group a section belongs to. */
export function groupForSection(id: SettingsSectionId): SettingsGroupSpec {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id);
  const groupId = section?.group;
  const group = SETTINGS_GROUPS.find((g) => g.id === groupId);
  if (!group) throw new Error(`settings registry: section ${id} has no group`);
  return group;
}