import { describe, expect, it } from "vitest";
import { resolveFileLink } from "@/lib/shared/file-link";

const CWD = "/home/me/proj";

describe("resolveFileLink", () => {
  it("keeps an absolute file path", () => {
    expect(resolveFileLink("/home/me/proj/app/page.tsx", CWD)).toEqual({
      path: "/home/me/proj/app/page.tsx",
      name: "page.tsx",
    });
  });

  it("resolves a cwd-relative path", () => {
    expect(resolveFileLink("app/page.tsx", CWD)).toEqual({
      path: "/home/me/proj/app/page.tsx",
      name: "page.tsx",
    });
    expect(resolveFileLink("./src/a.ts", CWD)).toEqual({
      path: "/home/me/proj/src/a.ts",
      name: "a.ts",
    });
  });

  it("folds `..` and `.` segments", () => {
    expect(resolveFileLink("../other/b.ts", "/home/me/proj/src")).toEqual({
      path: "/home/me/proj/other/b.ts",
      name: "b.ts",
    });
    expect(resolveFileLink("/home/me/./proj/../proj/x.md", CWD)).toEqual({
      path: "/home/me/proj/x.md",
      name: "x.md",
    });
  });

  it("decodes percent escapes", () => {
    expect(resolveFileLink("/home/me/my%20proj/a.ts", CWD)?.path).toBe("/home/me/my proj/a.ts");
  });

  it("drops a fragment", () => {
    expect(resolveFileLink("/home/me/proj/README.md#usage", CWD)).toEqual({
      path: "/home/me/proj/README.md",
      name: "README.md",
    });
  });

  it("accepts a Windows absolute path", () => {
    expect(resolveFileLink("C:\\Users\\me\\a.ts", CWD)?.path).toBe("C:/Users/me/a.ts");
  });

  it("leaves external schemes, fragments and queries alone", () => {
    expect(resolveFileLink("https://example.com/docs", CWD)).toBeNull();
    expect(resolveFileLink("http://example.com/a", CWD)).toBeNull();
    expect(resolveFileLink("mailto:me@example.com", CWD)).toBeNull();
    expect(resolveFileLink("data:text/plain,hi", CWD)).toBeNull();
    expect(resolveFileLink("file:///home/me/a.ts", CWD)).toBeNull();
    expect(resolveFileLink("#section", CWD)).toBeNull();
    expect(resolveFileLink("?session=1", CWD)).toBeNull();
    expect(resolveFileLink("//example.com/x", CWD)).toBeNull();
  });

  it("cannot resolve a relative path without a cwd", () => {
    expect(resolveFileLink("app/page.tsx", null)).toBeNull();
    expect(resolveFileLink("app/page.tsx", undefined)).toBeNull();
  });

  it("is null for empty hrefs", () => {
    expect(resolveFileLink("", CWD)).toBeNull();
    expect(resolveFileLink("   ", CWD)).toBeNull();
    expect(resolveFileLink(null, CWD)).toBeNull();
  });
});
