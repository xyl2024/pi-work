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
    }
    return;
  }
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(preferences, null, 2) + "\n", "utf8");
  renameSync(temp, path);
}

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
