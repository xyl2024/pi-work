import { describe, expect, it } from "vitest";
import {
  isAllowedMemoryFileName,
  parseMemoryIndexDescriptions,
} from "@/lib/shared/memory-main-view";

describe("parseMemoryIndexDescriptions", () => {
  it("extracts the registered description per category file", () => {
    const descriptions = parseMemoryIndexDescriptions(
      [
        "# 记忆索引",
        "",
        "## 分类目录",
        "- agent-notes.md — Agent 工作笔记",
        "- user-profile.md — 用户资料与偏好",
        "",
        "## 用户偏好摘要",
        "（待整理）",
      ].join("\n"),
    );
    expect(descriptions).toEqual({
      "agent-notes.md": "Agent 工作笔记",
      "user-profile.md": "用户资料与偏好",
    });
  });

  it("returns an empty map for an empty or header-only index", () => {
    expect(parseMemoryIndexDescriptions("")).toEqual({});
    expect(parseMemoryIndexDescriptions("# 记忆索引\n\n（暂无分类）")).toEqual({});
  });
});

describe("isAllowedMemoryFileName", () => {
  it("accepts one-level md names", () => {
    expect(isAllowedMemoryFileName("agent-notes.md")).toBe(true);
    expect(isAllowedMemoryFileName("INDEX.md")).toBe(true);
  });

  it("rejects traversal, nesting, absolute paths and non-md suffixes", () => {
    expect(isAllowedMemoryFileName("../config.yaml")).toBe(false);
    expect(isAllowedMemoryFileName("a/b.md")).toBe(false);
    expect(isAllowedMemoryFileName("/etc/passwd")).toBe(false);
    expect(isAllowedMemoryFileName("notes.txt")).toBe(false);
    expect(isAllowedMemoryFileName("..")).toBe(false);
    expect(isAllowedMemoryFileName(".md")).toBe(false);
    expect(isAllowedMemoryFileName("a\\b.md")).toBe(false);
  });
});
