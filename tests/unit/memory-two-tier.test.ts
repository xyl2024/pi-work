import { describe, expect, it } from "vitest";
import {
  MEMORY_EMPTY_STATE,
  MEMORY_GUIDANCE,
  MEMORY_INDEX_BUDGET,
  MEMORY_INDEX_FILE,
  MEMORY_ARCHIVE_SUFFIX,
  planMemoryMigration,
  renderMemoryIndex,
  renderMemoryInjection,
  type MemoryMigrationPlan,
} from "@/lib/shared/memory-two-tier";

describe("renderMemoryInjection", () => {
  it("returns guidance plus index when index has content", () => {
    const block = renderMemoryInjection("# 记忆索引\n\n- user-profile.md — 用户资料");
    expect(block).toContain(MEMORY_GUIDANCE);
    expect(block).toContain("## 当前记忆索引");
    expect(block).toContain("- user-profile.md — 用户资料");
  });

  it("returns guidance with empty-state text when index is blank", () => {
    for (const indexContent of ["", "   \n  "]) {
      const block = renderMemoryInjection(indexContent);
      expect(block).toContain(MEMORY_GUIDANCE);
      expect(block).toContain(MEMORY_EMPTY_STATE);
      expect(block).not.toContain("## 当前记忆索引");
    }
  });
});

describe("renderMemoryIndex", () => {
  it("lists categories and summary sections", () => {
    const index = renderMemoryIndex([
      { file: "agent-notes.md", description: "Agent 笔记" },
      { file: "user-profile.md", description: "用户资料" },
    ]);
    expect(index).toContain("# 记忆索引");
    expect(index).toContain("- agent-notes.md — Agent 笔记");
    expect(index).toContain("- user-profile.md — 用户资料");
    expect(index).toContain("## 用户偏好摘要");
  });

  it("marks no categories when list is empty", () => {
    const index = renderMemoryIndex([]);
    expect(index).toContain("（暂无分类）");
  });
});

describe("planMemoryMigration", () => {
  const memoryRaw = "likes dark mode\n§\nuses vim";
  const userRaw = "name: Alice\n§\nspeaks Chinese";

  it("maps legacy entries to suggested category files and generates an index", () => {
    const plan = planMemoryMigration({ memoryRaw, userRaw });
    expect(plan).not.toBeNull();
    const detailFiles = plan!.files.map((file) => file.path);
    expect(detailFiles).toEqual(["agent-notes.md", "user-profile.md"]);
    expect(plan!.files[0].content).toBe("likes dark mode\n\nuses vim");
    expect(plan!.files[1].content).toBe("name: Alice\n\nspeaks Chinese");
    expect(plan!.index.path).toBe(MEMORY_INDEX_FILE);
    expect(plan!.index.content).toContain("- agent-notes.md — ");
    expect(plan!.index.content).toContain("- user-profile.md — ");
  });

  it("archives legacy files with .bak suffix instead of deleting", () => {
    const plan = planMemoryMigration({ memoryRaw, userRaw });
    expect(plan!.archives).toEqual([
      { from: "MEMORY.md", to: `MEMORY.md${MEMORY_ARCHIVE_SUFFIX}` },
      { from: "USER.md", to: `USER.md${MEMORY_ARCHIVE_SUFFIX}` },
    ]);
  });

  it("skips categories for empty libraries", () => {
    const plan = planMemoryMigration({ memoryRaw, userRaw: "" });
    expect(plan!.files.map((file) => file.path)).toEqual(["agent-notes.md"]);
    expect(plan!.archives).toEqual([{ from: "MEMORY.md", to: `MEMORY.md${MEMORY_ARCHIVE_SUFFIX}` }]);
    expect(plan!.index.content).not.toContain("user-profile.md");
  });

  it("returns null when both libraries are absent or blank", () => {
    expect(planMemoryMigration({ memoryRaw: null, userRaw: null })).toBeNull();
    expect(planMemoryMigration({ memoryRaw: "  \n ", userRaw: "" })).toBeNull();
  });

  it("is idempotent: same inputs yield the same plan and blank inputs stay no-ops", () => {
    const first = planMemoryMigration({ memoryRaw, userRaw });
    const second = planMemoryMigration({ memoryRaw, userRaw });
    expect(second).toEqual(first);
    expect(planMemoryMigration({ memoryRaw: null, userRaw: null })).toBeNull();
  });

  it("keeps generated index within budget", () => {
    const plan: MemoryMigrationPlan = planMemoryMigration({ memoryRaw, userRaw })!;
    expect(plan.index.content.length).toBeLessThanOrEqual(MEMORY_INDEX_BUDGET);
  });
});
