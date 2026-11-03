import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/memory/entries/route";
import { readConfig, writeConfig } from "@/lib/server/config";
import { MEMORY_ENTRY_SEPARATOR } from "@/lib/shared/memory";
import { createSandbox, type Sandbox } from "./sandbox";

function seedLibrary(sandbox: Sandbox, file: string, entries: readonly string[]): void {
  const dir = join(sandbox.dataDir, "memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), entries.join(MEMORY_ENTRY_SEPARATOR), "utf8");
}

function unreadableLibrary(sandbox: Sandbox, file: string): void {
  mkdirSync(join(sandbox.dataDir, "memory", file), { recursive: true });
}

function setGlobalMemory(enabled: boolean): void {
  writeConfig({ ...readConfig(), memory: { enabled } });
}

function getRequest(): Request {
  return new Request("http://localhost/api/memory/entries");
}

describe("GET /api/memory/entries", () => {
  it("reports both never-written libraries as missing and empty", async () => {
    createSandbox("pi-work-memory-entries-route-");
    setGlobalMemory(true);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      globalEnabled: true,
      memory: {
        target: "memory",
        file: "MEMORY.md",
        status: "missing",
        entries: [],
        used: 0,
        limit: 2200,
      },
      user: {
        target: "user",
        file: "USER.md",
        status: "missing",
        entries: [],
        used: 0,
        limit: 1375,
      },
    });
  });

  it("returns every entry with its index, length, oversized flag and hash", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    const runaway = "手写".repeat(1200);
    seedLibrary(sandbox, "MEMORY.md", ["用户用 WSL2", runaway]);
    seedLibrary(sandbox, "USER.md", ["回复用中文"]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.memory.status).toBe("ok");
    expect(body.memory.entries).toEqual([
      {
        index: 0,
        text: "用户用 WSL2",
        length: "用户用 WSL2".length,
        oversized: false,
        hash: expect.any(String),
      },
      {
        index: 1,
        text: runaway,
        length: runaway.length,
        oversized: true,
        hash: expect.any(String),
      },
    ]);
    expect(body.memory.used).toBe(["用户用 WSL2", runaway].join(MEMORY_ENTRY_SEPARATOR).length);
    expect(body.memory.limit).toBe(2200);
    expect(body.user.entries.map((entry: { text: string }) => entry.text)).toEqual(["回复用中文"]);
    expect(body.user.used).toBe("回复用中文".length);
  });

  it("keeps an unreadable library distinguishable from a missing one", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    unreadableLibrary(sandbox, "MEMORY.md");

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.memory.status).toBe("unreadable");
    expect(body.memory.entries).toEqual([]);
    expect(body.user.status).toBe("missing");
  });

  it("reports the global switch so a turned-off library stays visible", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedLibrary(sandbox, "MEMORY.md", ["用户用 WSL2"]);
    setGlobalMemory(false);

    const body = await (await GET(getRequest())).json();

    expect(body.globalEnabled).toBe(false);
    expect(body.memory.entries.map((entry: { text: string }) => entry.text)).toEqual(["用户用 WSL2"]);
  });
});
