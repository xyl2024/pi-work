import { describe, expect, it } from "vitest";
import { memoryLibraryState, memoryLibraryView } from "@/lib/shared/memory";

describe("memory library state", () => {
  it("shows entries for a readable library that has some", () => {
    const view = memoryLibraryView({
      target: "memory",
      status: "ok",
      entries: ["用户用 WSL2"],
      limit: 2200,
    });

    expect(memoryLibraryState(view)).toBe("entries");
  });

  it("shows the empty state for a library that was never written", () => {
    const view = memoryLibraryView({
      target: "memory",
      status: "missing",
      entries: [],
      limit: 2200,
    });

    expect(memoryLibraryState(view)).toBe("empty");
  });

  it("shows the empty state for a readable library with no entries", () => {
    const view = memoryLibraryView({ target: "user", status: "ok", entries: [], limit: 1375 });

    expect(memoryLibraryState(view)).toBe("empty");
  });

  it("never degrades an unreadable library into the empty state", () => {
    const view = memoryLibraryView({
      target: "user",
      status: "unreadable",
      entries: [],
      limit: 1375,
    });

    expect(memoryLibraryState(view)).toBe("unreadable");
  });
});
