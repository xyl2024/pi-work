import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAgentCompaction,
  resetAgentCompaction,
  writeAgentCompaction,
} from "@/lib/server/agent-settings";
import { DEFAULT_AGENT_COMPACTION } from "@/lib/shared/agent-settings-types";

let agentDir: string;
const previousDir = process.env.PI_CODING_AGENT_DIR;

function settingsPath(): string {
  return join(agentDir, "settings.json");
}

function writeSettings(value: unknown): void {
  writeFileSync(settingsPath(), JSON.stringify(value, null, 2), "utf8");
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-work-compaction-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("agent compaction settings", () => {
  it("falls back to the pi defaults when the file has no compaction block", async () => {
    writeSettings({ retry: { enabled: false } });
    await expect(readAgentCompaction()).resolves.toEqual(DEFAULT_AGENT_COMPACTION);
  });

  it("reads the fields it exposes and keeps the defaults for broken ones", async () => {
    writeSettings({ compaction: { enabled: false, reserveTokens: 40000, keepRecentTokens: -1 } });
    await expect(readAgentCompaction()).resolves.toEqual({
      enabled: false,
      reserveTokens: 40000,
      keepRecentTokens: DEFAULT_AGENT_COMPACTION.keepRecentTokens,
    });
  });

  it("writes only the exposed fields and leaves every other setting in place", async () => {
    writeSettings({
      retry: { enabled: false },
      compaction: { modelOverrides: { "anthropic/claude": { reserveTokens: 9000 } } },
    });

    await writeAgentCompaction({ enabled: true, reserveTokens: 30000, keepRecentTokens: 25000 });

    expect(readSettings()).toEqual({
      retry: { enabled: false },
      compaction: {
        modelOverrides: { "anthropic/claude": { reserveTokens: 9000 } },
        enabled: true,
        reserveTokens: 30000,
        keepRecentTokens: 25000,
      },
    });
    await expect(readAgentCompaction()).resolves.toEqual({
      enabled: true,
      reserveTokens: 30000,
      keepRecentTokens: 25000,
    });
  });

  it("reset drops the exposed fields but keeps the rest of the compaction block", async () => {
    writeSettings({
      compaction: {
        enabled: false,
        reserveTokens: 30000,
        keepRecentTokens: 25000,
        modelOverrides: { "anthropic/claude": { reserveTokens: 9000 } },
      },
    });

    await resetAgentCompaction();

    expect(readSettings()).toEqual({
      compaction: { modelOverrides: { "anthropic/claude": { reserveTokens: 9000 } } },
    });
    await expect(readAgentCompaction()).resolves.toEqual(DEFAULT_AGENT_COMPACTION);
  });

  it("reset removes the compaction block entirely when nothing else is in it", async () => {
    writeSettings({ compaction: { enabled: false }, retry: { enabled: false } });

    await resetAgentCompaction();

    expect(readSettings()).toEqual({ retry: { enabled: false } });
  });
});
