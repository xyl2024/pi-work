/**
 * 图标偏好 (model icon preferences) store: a tiny JSON map under the Pi Work
 * data root (`PI_WORK_DATA_DIR` respected via dataPath()).
 *
 * Only real deviations are stored — `provider:modelId` → `"provider"` means
 * "show the provider icon instead of the auto match". Switching back to the
 * auto match deletes the entry; there are no positive "auto" entries. When the
 * map becomes empty the file is removed, so a user without preferences carries
 * no file at all.
 *
 * Reads are total: a missing/corrupt file, or non-object/array/unknown values,
 * degrade to "no deviations" (see normalizeModelIconPreferences).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dataPath } from "./data-dir";
import {
  MODEL_ICON_PREFERENCE_PROVIDER,
  modelIconPreferenceKey,
  normalizeModelIconPreferences,
  type ModelIconPreferences,
  type ModelIconPreference,
} from "../shared/model-icon-match";

const FILE_NAME = "model-icon-preferences.json";

function filePath(): string {
  return dataPath(FILE_NAME);
}

export function readModelIconPreferences(): ModelIconPreferences {
  const path = filePath();
  if (!existsSync(path)) return {};
  try {
    return normalizeModelIconPreferences(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return {};
  }
}

function writeModelIconPreferences(preferences: ModelIconPreferences): void {
  const path = filePath();
  mkdirSync(dataPath(), { recursive: true });
  if (Object.keys(preferences).length === 0) {
    try {
      unlinkSync(path);
    } catch {
      /* already absent */
    }
    return;
  }
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(preferences, null, 2) + "\n", "utf8");
  renameSync(temp, path);
}

/**
 * Apply one deviation and return the whole updated map. `"provider"` stores the
 * entry, `"auto"` deletes it. Validation is the caller's job (route → 400).
 */
export function setModelIconPreference(
  provider: string,
  modelId: string,
  preference: ModelIconPreference,
): ModelIconPreferences {
  const preferences = readModelIconPreferences();
  const key = modelIconPreferenceKey(provider, modelId);
  if (preference === MODEL_ICON_PREFERENCE_PROVIDER) {
    preferences[key] = MODEL_ICON_PREFERENCE_PROVIDER;
  } else {
    delete preferences[key];
  }
  writeModelIconPreferences(preferences);
  return preferences;
}
