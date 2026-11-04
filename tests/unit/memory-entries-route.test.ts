import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DELETE, GET } from "@/app/api/memory/entries/route";
import { readConfig, writeConfig } from "@/lib/server/config";
import { writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { MEMORY_ENTRY_SEPARATOR, memoryEntryHash } from "@/lib/shared/memory";
import { createSandbox, seedMemoryLibrary, type Sandbox } from "./sandbox";

function unreadableLibrary(sandbox: Sandbox, file: string): void {
  mkdirSync(join(sandbox.dataDir, "memory", file), { recursive: true });
}

function setGlobalMemory(enabled: boolean): void {
  writeConfig({ ...readConfig(), memory: { enabled } });
}

function getRequest(cwd?: string): Request {
  const url = cwd === undefined
    ? "http://localhost/api/memory/entries"
    : `http://localhost/api/memory/entries?cwd=${encodeURIComponent(cwd)}`;
  return new Request(url);
}

describe("GET /api/memory/entries", () => {
  it("reports both never-written libraries as missing and empty", async () => {
    createSandbox("pi-work-memory-entries-route-");
    setGlobalMemory(true);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      memory: {
        target: "memory",
        file: "MEMORY.md",
        status: "missing",
        entries: [],
        hash: expect.any(String),
        used: 0,
        limit: 2200,
      },
      user: {
        target: "user",
        file: "USER.md",
        status: "missing",
        entries: [],
        hash: expect.any(String),
        used: 0,
        limit: 1375,
      },
    });
  });

  it("returns every entry with its index, length, oversized flag and hash", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    const runaway = "手写".repeat(1200);
    seedMemoryLibrary(sandbox, "memory", ["用户用 WSL2", runaway]);
    seedMemoryLibrary(sandbox, "user", ["回复用中文"]);

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
    seedMemoryLibrary(sandbox, "memory", ["用户用 WSL2"]);
    setGlobalMemory(false);

    const body = await (await GET(getRequest())).json();

    expect(body.enabled).toBe(false);
    expect(body.memory.entries.map((entry: { text: string }) => entry.text)).toEqual(["用户用 WSL2"]);
  });

  it("reports the effective switch for a cwd recorded off", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["用户用 WSL2"]);
    setGlobalMemory(true);
    writeMemoryCwdEnabled("/work/secret", false);

    const body = await (await GET(getRequest("/work/secret"))).json();

    expect(body.enabled).toBe(false);
    expect(body.memory.entries.map((entry: { text: string }) => entry.text)).toEqual(["用户用 WSL2"]);
  });

  it("falls back to the global switch when no cwd is given", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["用户用 WSL2"]);
    setGlobalMemory(true);
    writeMemoryCwdEnabled("/work/secret", false);

    const body = await (await GET(getRequest())).json();

    expect(body.enabled).toBe(true);
  });
});

function deleteRequest(body: unknown, cwd?: string): Request {
  const url = cwd === undefined
    ? "http://localhost/api/memory/entries"
    : `http://localhost/api/memory/entries?cwd=${encodeURIComponent(cwd)}`;
  return new Request(url, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/memory/entries", () => {
  it("rejects a body without a valid target, index or hash", async () => {
    createSandbox("pi-work-memory-entries-route-");

    const cases: Array<[unknown, string]> = [
      [{ index: 0, hash: "x" }, "target must be memory or user"],
      [{ target: "other", index: 0, hash: "x" }, "target must be memory or user"],
      [{ target: "memory", hash: "x" }, "index must be a non-negative integer"],
      [{ target: "memory", index: -1, hash: "x" }, "index must be a non-negative integer"],
      [{ target: "memory", index: 0 }, "hash is required"],
      [{ target: "memory", index: 0, hash: "" }, "hash is required"],
    ];

    for (const [body, error] of cases) {
      const response = await DELETE(deleteRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
    }

    const malformed = await DELETE(
      new Request("http://localhost/api/memory/entries", { method: "DELETE", body: "not json" }),
    );
    expect(malformed.status).toBe(400);
  });

  it("deletes the pinned entry and returns the write-after snapshot", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["第一条", "第二条", "第三条"]);
    seedMemoryLibrary(sandbox, "user", ["回复用中文"]);
    setGlobalMemory(true);

    const response = await DELETE(
      deleteRequest({ target: "memory", index: 1, hash: memoryEntryHash("第二条") }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.memory.entries.map((entry: { text: string }) => entry.text)).toEqual([
      "第一条",
      "第三条",
    ]);
    expect(body.memory.used).toBe("第一条\n§\n第三条".length);
    expect(body.user.entries.map((entry: { text: string }) => entry.text)).toEqual(["回复用中文"]);
    expect(readFileSync(join(sandbox.dataDir, "memory", "MEMORY.md"), "utf8")).toBe(
      "第一条\n§\n第三条",
    );
  });

  it("reports the cwd's effective switch after a delete", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["第一条", "第二条"]);
    setGlobalMemory(true);
    writeMemoryCwdEnabled("/work/secret", false);

    const response = await DELETE(
      deleteRequest({ target: "memory", index: 0, hash: memoryEntryHash("第一条") }, "/work/secret"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.memory.entries.map((entry: { text: string }) => entry.text)).toEqual(["第二条"]);
  });

  it("rejects a stale hash without touching the file", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["第一条", "第二条"]);

    const response = await DELETE(
      deleteRequest({ target: "memory", index: 0, hash: memoryEntryHash("旧内容") }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "条目在你确认前已被改动，已拒绝删除，请刷新后再试。",
      code: "stale_entry",
    });
    expect(readFileSync(join(sandbox.dataDir, "memory", "MEMORY.md"), "utf8")).toBe(
      "第一条\n§\n第二条",
    );
  });

  it("rejects an out-of-range index", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["第一条"]);

    const response = await DELETE(
      deleteRequest({ target: "memory", index: 9, hash: memoryEntryHash("第一条") }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "条目索引越界，记忆库可能已被改动，请刷新后再删。",
      code: "out_of_range",
    });
  });

  it("surfaces a busy store as an error with its reason", async () => {
    const sandbox = createSandbox("pi-work-memory-entries-route-");
    seedMemoryLibrary(sandbox, "memory", ["第一条", "第二条"]);
    const lockFile = join(sandbox.dataDir, "memory", ".lock");
    writeFileSync(lockFile, "", "utf8");
    utimesSync(lockFile, 2_000_000_000, 2_000_000_000);

    let tick = Date.now();
    const spy = vi.spyOn(Date, "now").mockImplementation(() => {
      tick += 1000;
      return tick;
    });
    try {
      const response = await DELETE(
        deleteRequest({ target: "memory", index: 0, hash: memoryEntryHash("第一条") }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "记忆库正被其它会话写入，请稍后重试。",
        code: "busy",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
