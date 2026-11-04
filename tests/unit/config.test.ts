import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { isSettingsOwnedKey } from "@/lib/shared/settings-keys";

const root = mkdtempSync(join(tmpdir(), "pi-work-config-"));
const configPath = join(root, "config.yaml");

let readConfig: () => PiWorkConfig;
let writeConfig: (config: PiWorkConfig) => PiWorkConfig;
let mergeRightSideBar: typeof import("@/lib/server/config").mergeRightSideBar;

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  const mod = await import("@/lib/server/config");
  readConfig = mod.readConfig;
  writeConfig = mod.writeConfig;
  mergeRightSideBar = mod.mergeRightSideBar;
});

beforeEach(() => {
  globalThis.__piWorkConfigCache = undefined;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("config: in-process cache", () => {
  it("sees its own write on the next read", () => {
    const base = readConfig();
    writeConfig({ ...base, load_pi_docs: false });
    expect(readConfig().load_pi_docs).toBe(false);

    writeConfig({ ...base, load_pi_docs: true });
    expect(readConfig().load_pi_docs).toBe(true);
  });

  it("picks up a hand edit once the file changes", () => {
    writeConfig(readConfig());
    writeFileSync(configPath, "load_pi_docs: false\n", "utf8");
    expect(readConfig().load_pi_docs).toBe(false);
  });

  it("resets to defaults when the file is missing", () => {
    rmSync(configPath, { force: true });
    const config = readConfig();
    expect(config.load_pi_docs).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it("resets to defaults when the file does not parse", () => {
    writeFileSync(configPath, "a: b: c\n", "utf8");
    const config = readConfig();
    expect(config.load_pi_docs).toBe(true);
    expect(readFileSync(configPath, "utf8")).toContain("load_pi_docs: true");
  });

  it("defaults the text selection toolbar on and parses an explicit off", () => {
    rmSync(configPath, { force: true });
    expect(readConfig().text_selection_toolbar.enabled).toBe(true);

    writeFileSync(configPath, "text_selection_toolbar:\n  enabled: false\n", "utf8");
    expect(readConfig().text_selection_toolbar.enabled).toBe(false);
  });

  it("defaults memory off and only enables it on an explicit true", () => {
    rmSync(configPath, { force: true });
    expect(readConfig().memory.enabled).toBe(false);

    writeFileSync(configPath, "memory:\n  enabled: false\n", "utf8");
    expect(readConfig().memory.enabled).toBe(false);

    writeFileSync(configPath, "memory:\n  enabled: true\n", "utf8");
    expect(readConfig().memory.enabled).toBe(true);
  });

  it("owns the memory settings key", () => {
    expect(isSettingsOwnedKey("memory")).toBe(true);
  });
});

describe("config: right-side-bar keys that left the registry", () => {
  it("keeps the legacy scheduler key through a read/write round trip", () => {
    writeFileSync(
      configPath,
      "right_side_bar:\n  scheduler: false\n  channels: false\n  skills: false\n",
      "utf8",
    );

    const config = readConfig();
    expect(config.right_side_bar.scheduler).toBe(false);
    expect(config.right_side_bar.channels).toBe(false);
    expect(config.right_side_bar.skills).toBe(false);

    writeConfig(config);

    const written = load(readFileSync(configPath, "utf8")) as {
      right_side_bar: Record<string, unknown>;
    };
    expect(written.right_side_bar.scheduler).toBe(false);
    expect(written.right_side_bar.channels).toBe(false);
    expect(readConfig().right_side_bar.scheduler).toBe(false);
    expect(readConfig().right_side_bar.channels).toBe(false);
  });

  it("merges an incoming block over the stored one so unknown keys survive a save", () => {
    const merged = mergeRightSideBar(
      { scheduler: false, skills: false, session_bound_alignment: "bottom" },
      { skills: true },
    );

    expect(merged).toEqual({ scheduler: false, skills: true, session_bound_alignment: "bottom" });
  });
});
