import { describe, expect, it } from "vitest";
import { isMarkdownPath } from "@/components/files/file-viewer/utils";

describe("isMarkdownPath", () => {
  it("matches markdown extensions case-insensitively", () => {
    expect(isMarkdownPath("/proj/README.md")).toBe(true);
    expect(isMarkdownPath("/proj/notes.markdown")).toBe(true);
    expect(isMarkdownPath("/proj/slide.mdx")).toBe(true);
    expect(isMarkdownPath("/proj/GUIDE.MD")).toBe(true);
  });

  it("does not match non-markdown files", () => {
    expect(isMarkdownPath("/proj/app.tsx")).toBe(false);
    expect(isMarkdownPath("/proj/data.json")).toBe(false);
    expect(isMarkdownPath("/proj/md")).toBe(false);
    expect(isMarkdownPath("/proj/notes.mdx.bak")).toBe(false);
  });
});
