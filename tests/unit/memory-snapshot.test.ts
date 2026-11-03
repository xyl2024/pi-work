import { describe, expect, it } from "vitest";
import {
  formatMemorySnapshotTime,
  memoryEntryHash,
  memoryEntryViews,
  memoryLibrarySnapshot,
  memoryLibraryView,
  memorySnapshotChanges,
  memorySnapshotDifference,
  type MemoryEntryView,
  type MemoryLibrariesView,
  type MemoryLibrarySnapshot,
  type SessionMemorySnapshot,
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

function currentOf(memory: readonly string[], user: readonly string[] = []): MemoryLibrariesView {
  return {
    memory: memoryLibraryView({ target: "memory", status: "ok", entries: memory, limit: LIMIT }),
    user: memoryLibraryView({ target: "user", status: "ok", entries: user, limit: LIMIT }),
  };
}

function sessionOf(
  memory: readonly string[] | null,
  user: readonly string[] | null = null,
  capturedAt = 1_700_000_000_000,
): SessionMemorySnapshot {
  return {
    capturedAt,
    memory: memory === null ? null : snapshotOf(memory),
    user: user === null ? null : snapshotOf(user),
  };
}

describe("memory library hash", () => {
  it("uses the same fingerprint as the session snapshot", () => {
    const entries = ["用户偏好中文", "项目用 pnpm"];

    expect(currentOf(entries).memory.hash).toBe(snapshotOf(entries).hash);
  });

  it("fingerprints blank entries the way injection does", () => {
    expect(currentOf(["用户偏好中文", "   "]).memory.hash).toBe(snapshotOf(["用户偏好中文"]).hash);
  });
});

describe("memory snapshot difference", () => {
  it("takes the library hash as the fast path to zero changes", () => {
    const snapshot = sessionOf(["a", "b"]);
    const current = currentOf(["a", "b"]);

    expect(current.memory.hash).toBe(snapshot.memory!.hash);
    expect(memorySnapshotDifference(snapshot, current)).toEqual({
      capturedAt: snapshot.capturedAt,
      changed: 0,
    });
  });

  it("reports zero changes when the file still matches the snapshot", () => {
    const snapshot = sessionOf(["a", "b"]);

    expect(memorySnapshotDifference(snapshot, currentOf(["a", "b"]))).toEqual({
      capturedAt: snapshot.capturedAt,
      changed: 0,
    });
  });

  it("falls back to the entry-level count when the library hash differs", () => {
    const snapshot = sessionOf(["a", "b"]);

    expect(memorySnapshotDifference(snapshot, currentOf(["a", "b", "c"]))?.changed).toBe(1);
    expect(memorySnapshotDifference(snapshot, currentOf(["a"]))?.changed).toBe(1);
  });

  it("counts entries added to a library that was empty at session start", () => {
    const snapshot = sessionOf(["a"], null);

    expect(memorySnapshotDifference(snapshot, currentOf(["a"], ["新条目"]))?.changed).toBe(1);
    expect(memorySnapshotDifference(snapshot, currentOf(["a"], []))?.changed).toBe(0);
  });

  it("shows nothing when the session captured no snapshot", () => {
    expect(memorySnapshotDifference(null, currentOf(["a"]))).toBeNull();
  });

  it("shows nothing when a library cannot be read", () => {
    const snapshot = sessionOf(["a"]);
    const current = currentOf(["a"]);
    current.user = { ...current.user, status: "unreadable" };

    expect(memorySnapshotDifference(snapshot, current)).toBeNull();
  });
});

describe("memory snapshot time", () => {
  it("formats the captured timestamp as local date and time to the minute", () => {
    const capturedAt = new Date(2024, 0, 2, 3, 4, 5).getTime();

    expect(formatMemorySnapshotTime(capturedAt)).toBe("2024-01-02 03:04");
  });
});
