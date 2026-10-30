import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWorkConfig } from "@/lib/shared/config-types";

const root = mkdtempSync(join(tmpdir(), "pi-work-config-"));
const configPath = join(root, "config.yaml");

let readConfig: () => PiWorkConfig;
let writeConfig: (config: PiWorkConfig) => PiWorkConfig;

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  const mod = await import("@/lib/server/config");
  readConfig = mod.readConfig;
  writeConfig = mod.writeConfig;
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
});
