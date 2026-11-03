import { describe, expect, it } from "vitest";
import {
  memoryEntryHash,
  memoryEntryViews,
  memoryLibrarySnapshot,
  memorySnapshotChanges,
  type MemoryEntryView,
  type MemoryLibrarySnapshot,
} from "@/lib/shared/memory";

const LIMIT = 2200;

function views(entries: readonly string[]): MemoryEntryView[] {
  return memoryEntryViews(entries, LIMIT);
}

function snapshotOf(entries: readonly string[]): MemoryLibrarySnapshot {
  const snapshot = memoryLibrarySnapshot(entries);
  if (snapshot === null) throw new Error("expected a snapshot");
  return snapshot;
}

describe("memory library snapshot", () => {
  it("carries the entry count and every entry hash from the entry view derivation", () => {
    const snapshot = snapshotOf(["用户偏好中文", "项目用 pnpm"]);

    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.entryHashes).toEqual([memoryEntryHash("用户偏好中文"), memoryEntryHash("项目用 pnpm")]);
  });

  it("fingerprints the library so a changed file has a different hash", () => {
    expect(snapshotOf(["旧事实"]).hash).toBe(snapshotOf(["旧事实"]).hash);
    expect(snapshotOf(["旧事实"]).hash).not.toBe(snapshotOf(["新事实"]).hash);
  });

  it("ignores blank entries the same way injection does", () => {
    expect(snapshotOf(["用户偏好中文", "   ", ""])).toMatchObject({ entryCount: 1 });
    expect(memoryLibrarySnapshot([])).toBeNull();
    expect(memoryLibrarySnapshot(["   ", "\n"])).toBeNull();
  });
});

describe("memory snapshot changes against the current file", () => {
  it("reports no changes when the file still matches the snapshot", () => {
    expect(memorySnapshotChanges(snapshotOf(["a", "b"]), views(["a", "b"]))).toBe(0);
  });

  it("reports one change after a single entry is deleted", () => {
    expect(memorySnapshotChanges(snapshotOf(["a", "b", "c"]), views(["a", "c"]))).toBe(1);
    expect(memorySnapshotChanges(snapshotOf(["a"]), views([]))).toBe(1);
  });

  it("reports one change after an entry is added", () => {
    expect(memorySnapshotChanges(snapshotOf(["a"]), views(["a", "b"]))).toBe(1);
  });

  it("reports two changes after an entry is rewritten in place", () => {
    expect(memorySnapshotChanges(snapshotOf(["a", "b"]), views(["a", "B"]))).toBe(2);
  });

  it("ignores blank entries in the current file", () => {
    expect(memorySnapshotChanges(snapshotOf(["a", "b"]), views(["a", "b", "  "]))).toBe(0);
  });
});
