import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMemoryEnabledForCwd,
  readMemoryCwdOverrides,
  writeMemoryCwdEnabled,
} from "@/lib/server/memory-cwd-store";
import { createSandbox } from "./sandbox";

const OVERRIDES_FILE = "memory-cwd.json";

function overridesFile(dataDir: string): string {
  return join(dataDir, OVERRIDES_FILE);
}

describe("memory cwd switch: three-state matrix", () => {
  it("enables a cwd when the global switch is on and the cwd is unrecorded", () => {
    createSandbox("pi-work-memory-cwd-");

    expect(isMemoryEnabledForCwd("/work/plain", true)).toBe(true);
  });

  it("disables a cwd recorded as off while the global switch stays on", () => {
    createSandbox("pi-work-memory-cwd-");
    writeMemoryCwdEnabled("/work/secret", false);

    expect(isMemoryEnabledForCwd("/work/secret", true)).toBe(false);
    expect(isMemoryEnabledForCwd("/work/other", true)).toBe(true);
  });

  it("disables every cwd when the global switch is off, records notwithstanding", () => {
    createSandbox("pi-work-memory-cwd-");
    writeMemoryCwdEnabled("/work/secret", false);
    writeMemoryCwdEnabled("/work/plain", true);

    expect(isMemoryEnabledForCwd("/work/secret", false)).toBe(false);
    expect(isMemoryEnabledForCwd("/work/plain", false)).toBe(false);
    expect(isMemoryEnabledForCwd("/work/unrecorded", false)).toBe(false);
  });

  it("restores a cwd once its off record is removed", () => {
    createSandbox("pi-work-memory-cwd-");
    writeMemoryCwdEnabled("/work/secret", false);
    writeMemoryCwdEnabled("/work/secret", true);

    expect(isMemoryEnabledForCwd("/work/secret", true)).toBe(true);
    expect(readMemoryCwdOverrides()).toEqual({});
  });
});

describe("memory cwd switch: override store", () => {
  it("persists only the cwds that were explicitly turned off", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-");

    writeMemoryCwdEnabled("/work/enabled-explicitly", true);
    writeMemoryCwdEnabled("/work/off", false);

    expect(JSON.parse(readFileSync(overridesFile(sandbox.dataDir), "utf8"))).toEqual({
      "/work/off": false,
    });
    expect(readMemoryCwdOverrides()).toEqual({ "/work/off": false });
  });

  it("removes the file when the last off record disappears", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-");
    writeMemoryCwdEnabled("/work/off", false);

    writeMemoryCwdEnabled("/work/off", true);

    expect(existsSync(overridesFile(sandbox.dataDir))).toBe(false);
    expect(readMemoryCwdOverrides()).toEqual({});
  });

  it("writes atomically, leaving no temp file behind", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-");

    writeMemoryCwdEnabled("/work/off", false);

    expect(readdirSync(sandbox.dataDir).filter((name) => name.includes(".tmp"))).toEqual([]);
    expect(readMemoryCwdOverrides()).toEqual({ "/work/off": false });
  });

  it("drops entries that are not an explicit false", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-");
    mkdirSync(sandbox.dataDir, { recursive: true });
    writeFileSync(
      overridesFile(sandbox.dataDir),
      JSON.stringify({ "/work/off": false, "/work/on": true, "/work/junk": "no" }),
      "utf8",
    );

    expect(readMemoryCwdOverrides()).toEqual({ "/work/off": false });
    expect(isMemoryEnabledForCwd("/work/on", true)).toBe(true);
  });

  it("refuses to overwrite an override file it cannot parse", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-");
    mkdirSync(sandbox.dataDir, { recursive: true });
    writeFileSync(overridesFile(sandbox.dataDir), "{ not json", "utf8");

    expect(() => writeMemoryCwdEnabled("/work/off", false)).toThrow();
    expect(readFileSync(overridesFile(sandbox.dataDir), "utf8")).toBe("{ not json");
  });
});
