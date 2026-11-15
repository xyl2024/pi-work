import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client/memory-io", () => ({
  MemoryDisabledError: class MemoryDisabledError extends Error {},
  fetchMemoryFiles: vi.fn(async () => []),
  fetchMemoryFile: vi.fn(async () => ({ content: "", mtime: "" })),
  saveMemoryFile: vi.fn(async () => ({ mtime: "" })),
  createMemoryFile: vi.fn(),
  deleteMemoryFile: vi.fn(),
}));

import { createMemoryFile, deleteMemoryFile, fetchMemoryFiles } from "@/lib/client/memory-io";
import {
  createMemoryCategory,
  deleteMemoryCategory,
  memoryPanel,
  selectMemoryFile,
} from "@/lib/client/memory-panel";

const created: { file: string }[] = [
  { file: "INDEX.md" },
  { file: "agent-notes.md" },
];

function seedFiles(files: { file: string }[]): void {
  vi.mocked(fetchMemoryFiles).mockResolvedValue(
    files.map((file) => ({ ...file, isIndex: file.file === "INDEX.md", mtime: "", description: "" })),
  );
}

beforeEach(() => {
  vi.mocked(createMemoryFile).mockReset();
  vi.mocked(deleteMemoryFile).mockReset();
  seedFiles(created);
  memoryPanel.patch({
    loading: false,
    loaded: true,
    loadError: null,
    disabled: false,
    files: created.map((file) => ({ ...file, isIndex: file.file === "INDEX.md", mtime: "", description: "" })),
    selectedFile: "agent-notes.md",
    detailLoading: false,
    detailError: null,
    content: "",
    baseline: "",
    saving: false,
    saveError: null,
    createError: null,
    deleting: false,
    deleteError: null,
  });
});

describe("creating a category file", () => {
  it("creates the file, refreshes the list and selects it", async () => {
    vi.mocked(createMemoryFile).mockResolvedValue({ created: true });
    seedFiles([...created, { file: "user-notes.md" }]);

    await createMemoryCategory("user-notes.md");

    expect(createMemoryFile).toHaveBeenCalledWith("user-notes.md");
    const state = memoryPanel.get();
    expect(state.files.map((file) => file.file)).toContain("user-notes.md");
    expect(state.selectedFile).toBe("user-notes.md");
    expect(state.createError).toBeNull();
  });

  it("surfaces duplicate names as an input error without changing selection", async () => {
    vi.mocked(createMemoryFile).mockRejectedValue(new Error("Memory file already exists"));

    await createMemoryCategory("agent-notes.md");

    expect(memoryPanel.get().createError).toBe("Memory file already exists");
    expect(memoryPanel.get().selectedFile).toBe("agent-notes.md");
  });
});

describe("deleting a category file", () => {
  it("deletes, refreshes the list and clears the selection", async () => {
    vi.mocked(deleteMemoryFile).mockResolvedValue({ deleted: true });
    seedFiles([{ file: "INDEX.md" }]);
    selectMemoryFile("agent-notes.md");
    await vi.waitFor(() => {
      expect(memoryPanel.get().selectedFile).toBe("agent-notes.md");
    });

    await deleteMemoryCategory("agent-notes.md");

    expect(deleteMemoryFile).toHaveBeenCalledWith("agent-notes.md");
    const state = memoryPanel.get();
    expect(state.files.map((file) => file.file)).toEqual(["INDEX.md"]);
    expect(state.selectedFile).toBeNull();
    expect(state.deleting).toBe(false);
    expect(state.deleteError).toBeNull();
  });

  it("surfaces delete failures without clearing the selection", async () => {
    vi.mocked(deleteMemoryFile).mockRejectedValue(new Error("boom"));

    await deleteMemoryCategory("agent-notes.md");

    const state = memoryPanel.get();
    expect(state.deleteError).toBe("boom");
    expect(state.selectedFile).toBe("agent-notes.md");
  });
});
