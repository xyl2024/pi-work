import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryEntryHash, memoryEntryViews } from "@/lib/shared/memory";
import { readMemoryView } from "@/lib/server/memory-store";
import { createSandbox, seedMemoryLibrary } from "./sandbox";

describe("memory entry views", () => {
  it("keeps the disk order and reports each entry's text and length", () => {
    const entries = ["用户用 WSL2", "回复用中文"];

    const views = memoryEntryViews(entries, 2200);

    expect(views.map((view) => view.index)).toEqual([0, 1]);
    expect(views.map((view) => view.text)).toEqual(entries);
    expect(views.map((view) => view.length)).toEqual(["用户用 WSL2".length, "回复用中文".length]);
  });

  it("derives an empty view list from an empty library", () => {
    expect(memoryEntryViews([], 2200)).toEqual([]);
  });

  it("marks only the entry that is longer than the whole-library limit", () => {
    const limit = 20;
    const entries = ["短条目", "x".repeat(limit), "y".repeat(limit + 1)];

    const views = memoryEntryViews(entries, limit);

    expect(views.map((view) => view.oversized)).toEqual([false, false, true]);
  });

  it("hashes an entry by its text alone", () => {
    expect(memoryEntryHash("用户用 WSL2")).toBe("e80f613078253b0c");
    expect(memoryEntryHash("回复用中文")).toBe("09ffed449fb9dda0");
  });

  it("gives the same text the same hash at different indexes", () => {
    const views = memoryEntryViews(["同一条事实", "另一条事实", "同一条事实"], 2200);

    expect(views[0]!.hash).toBe(views[2]!.hash);
    expect(views[0]!.hash).not.toBe(views[1]!.hash);
  });
});

describe("memory library views", () => {
  it("reads a store that was never written as an empty library view", () => {
    createSandbox("pi-work-memory-entry-view-");

    expect(readMemoryView("memory")).toEqual({
      target: "memory",
      file: "MEMORY.md",
      status: "missing",
      entries: [],
      hash: expect.any(String),
      used: 0,
      limit: 2200,
    });
  });

  it("views every entry and flags the oversized one", () => {
    const sandbox = createSandbox("pi-work-memory-entry-view-");
    const runaway = "手写".repeat(1200);
    seedMemoryLibrary(sandbox, "memory", ["用户用 WSL2", runaway]);

    const view = readMemoryView("memory");

    expect(view.status).toBe("ok");
    expect(view.entries.map((entry) => entry.text)).toEqual(["用户用 WSL2", runaway]);
    expect(view.entries.map((entry) => entry.oversized)).toEqual([false, true]);
    expect(view.entries[0]!.hash).toBe(memoryEntryHash("用户用 WSL2"));
  });

  it("keeps a bare § inside an entry instead of splitting it", () => {
    const sandbox = createSandbox("pi-work-memory-entry-view-");
    seedMemoryLibrary(sandbox, "memory", ["编号 § 规则写在文档里"]);

    const view = readMemoryView("memory");

    expect(view.entries.map((entry) => entry.text)).toEqual(["编号 § 规则写在文档里"]);
  });

  it("keeps an unreadable store distinguishable from an empty one", () => {
    const sandbox = createSandbox("pi-work-memory-entry-view-");
    mkdirSync(join(sandbox.dataDir, "memory", "MEMORY.md"), { recursive: true });

    expect(readMemoryView("memory")).toMatchObject({ status: "unreadable", entries: [], used: 0 });
  });
});
