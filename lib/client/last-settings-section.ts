import {
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/components/settings/registry";
import { getLocalStorage } from "./local-storage";

export const LAST_SETTINGS_SECTION_KEY = "pi-work:last-settings-section";

export type SettingsSectionStorage = Pick<Storage, "getItem" | "setItem">;

export function readLastSettingsSection(
  storage: SettingsSectionStorage | null = getLocalStorage(),
): SettingsSectionId | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(LAST_SETTINGS_SECTION_KEY);
  } catch {
    return null;
  }
  return isSettingsSectionId(raw) ? raw : null;
}

export function writeLastSettingsSection(
  id: SettingsSectionId,
  storage: SettingsSectionStorage | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_SETTINGS_SECTION_KEY, id);
  } catch {
  }
}
