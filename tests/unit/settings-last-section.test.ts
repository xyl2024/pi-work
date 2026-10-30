import { describe, expect, it } from "vitest";
import {
  LAST_SETTINGS_SECTION_KEY,
  readLastSettingsSection,
  writeLastSettingsSection,
  type SettingsSectionStorage,
} from "@/lib/client/last-settings-section";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
} from "@/components/settings/registry";

function memoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    snapshot: () => Object.fromEntries(entries),
  };
}

const brokenStorage: SettingsSectionStorage = {
  getItem: () => {
    throw new Error("storage unavailable");
  },
  setItem: () => {
    throw new Error("storage unavailable");
  },
};

describe("last settings section storage", () => {
  it("reads back what it wrote", () => {
    const storage = memoryStorage();
    writeLastSettingsSection("retry", storage);
    expect(readLastSettingsSection(storage)).toBe("retry");
    expect(storage.snapshot()[LAST_SETTINGS_SECTION_KEY]).toBe("retry");
  });

  it("pins the persisted key so existing values keep working", () => {
    expect(LAST_SETTINGS_SECTION_KEY).toBe("pi-work:last-settings-section");
  });

  it("returns null when nothing has been recorded", () => {
    expect(readLastSettingsSection(memoryStorage())).toBeNull();
  });

  it("returns null for a value that is not a registered section", () => {
    expect(
      readLastSettingsSection(memoryStorage({ [LAST_SETTINGS_SECTION_KEY]: "not-a-section" })),
    ).toBeNull();
    expect(
      readLastSettingsSection(memoryStorage({ [LAST_SETTINGS_SECTION_KEY]: "" })),
    ).toBeNull();
    expect(
      readLastSettingsSection(memoryStorage({ [LAST_SETTINGS_SECTION_KEY]: "constructor" })),
    ).toBeNull();
  });

  it("returns null when storage is unavailable or throws", () => {
    expect(readLastSettingsSection(null)).toBeNull();
    expect(readLastSettingsSection(brokenStorage)).toBeNull();
  });

  it("swallows write failures", () => {
    expect(() => writeLastSettingsSection("profile", brokenStorage)).not.toThrow();
    expect(() => writeLastSettingsSection("profile", null)).not.toThrow();
  });
});

describe("default settings section", () => {
  it("is Profile and stays a registered section", () => {
    expect(DEFAULT_SETTINGS_SECTION_ID).toBe("profile");
    expect(SETTINGS_SECTION_IDS).toContain(DEFAULT_SETTINGS_SECTION_ID);
  });

  it("guards persisted ids against the registry", () => {
    for (const id of SETTINGS_SECTION_IDS) expect(isSettingsSectionId(id)).toBe(true);
    expect(isSettingsSectionId("removed-section")).toBe(false);
    expect(isSettingsSectionId(null)).toBe(false);
    expect(isSettingsSectionId(42)).toBe(false);
  });
});
