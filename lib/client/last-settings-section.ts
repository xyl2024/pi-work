/**
 * Last-opened settings section persistence.
 *
 * The modal opens on the page the user was last looking at instead of always
 * starting over at Profile. Deliberately tiny, like the other Pi Work
 * localStorage layers (`last-used-model.ts`): plain string payload and silent
 * failures — a missing store, private mode, a full quota or a stale id all
 * degrade to "open Profile". The one difference is that this module takes its
 * storage as a parameter so tests can drive it without a browser.
 *
 * The stored value is validated against the settings registry, never trusted:
 * a section that was removed (or garbage written by hand) reads back as null.
 */

import {
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/components/settings/registry";
import { getLocalStorage } from "./local-storage";

export const LAST_SETTINGS_SECTION_KEY = "pi-work:last-settings-section";

/** The slice of `Storage` this module needs; tests inject a fake. */
export type SettingsSectionStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Read the remembered section, or null when there is nothing usable: storage
 * unavailable/throwing, no value, or a value the registry does not know.
 */
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

/** Remember the section that is now open. Best-effort; never throws. */
export function writeLastSettingsSection(
  id: SettingsSectionId,
  storage: SettingsSectionStorage | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_SETTINGS_SECTION_KEY, id);
  } catch {
    /* best-effort: the modal still works, it just opens on the default page. */
  }
}
