import { describe, expect, it } from "vitest";
import { getMentionQuery, getSlashQuery, isPathInsideCwd, resolveMentionDirectory } from "@/lib/shared/composer-queries";

describe("getSlashQuery", () => {
  it("does not trigger at the start of an empty input", () => {
    expect(getSlashQuery("", 0)).toBeNull();
  });

  it("finds the query when the cursor is right after a slash", () => {
    expect(getSlashQuery("/", 1)).toEqual({ start: 0, query: "" });
  });

  it("finds a partial query at the end of the text", () => {
    expect(getSlashQuery("/rev", 4)).toEqual({ start: 0, query: "rev" });
  });

  it("finds the query when the cursor sits in the middle of the text", () => {
    expect(getSlashQuery("/abc def", 4)).toEqual({ start: 0, query: "abc" });
  });

  it("only considers the candidate before the cursor", () => {
    expect(getSlashQuery("/first /sec", 11)).toEqual({ start: 7, query: "sec" });
  });

  it("triggers after whitespace", () => {
    expect(getSlashQuery("hi /mod", 7)).toEqual({ start: 3, query: "mod" });
  });

  it("treats a slash inside a word as a query start", () => {
    expect(getSlashQuery("foo/bar", 7)).toEqual({ start: 3, query: "bar" });
  });

  it("does not trigger on a scheme separator", () => {
    expect(getSlashQuery("https://", 8)).toBeNull();
    expect(getSlashQuery("see https://", 12)).toBeNull();
  });

  it("does not carry a query across whitespace", () => {
    expect(getSlashQuery("/done now", 9)).toBeNull();
  });

  it("restarts the query after a trailing slash", () => {
    expect(getSlashQuery("/foo/", 5)).toEqual({ start: 4, query: "" });
  });
});

describe("getMentionQuery", () => {
  it("does not trigger without a leading space or line start", () => {
    expect(getMentionQuery("hello@foo", 10)).toBeNull();
  });

  it("does not trigger at the start of an empty input", () => {
    expect(getMentionQuery("", 0)).toBeNull();
  });

  it("finds a mention at the start of the text", () => {
    expect(getMentionQuery("@src", 4)).toEqual({ start: 0, query: "src", directory: "" });
  });

  it("finds a mention after a space", () => {
    expect(getMentionQuery("look @src/comp", 14)).toEqual({ start: 5, query: "comp", directory: "src" });
  });

  it("finds a directory-only mention", () => {
    expect(getMentionQuery("@src/", 5)).toEqual({ start: 0, query: "", directory: "src" });
  });

  it("only considers the candidate before the cursor", () => {
    expect(getMentionQuery("@one @two", 9)).toEqual({ start: 5, query: "two", directory: "" });
  });

  it("normalizes backslash separators in the directory", () => {
    expect(getMentionQuery("@src\\comp\\", 11)).toEqual({ start: 0, query: "", directory: "src/comp" });
    expect(getMentionQuery("@src\\file.ts", 12)).toEqual({ start: 0, query: "file.ts", directory: "src" });
  });

  it("does not carry a mention across whitespace", () => {
    expect(getMentionQuery("@done now", 9)).toBeNull();
  });
});

describe("resolveMentionDirectory", () => {
  const cwd = "/repo/src";

  it("resolves an empty directory to the cwd", () => {
    expect(resolveMentionDirectory(cwd, "")).toBe("/repo/src");
  });

  it("resolves a nested directory inside the cwd", () => {
    expect(resolveMentionDirectory(cwd, "components/chat")).toBe("/repo/src/components/chat");
  });

  it("resolves dot navigation", () => {
    expect(resolveMentionDirectory(cwd, ".")).toBe("/repo/src/.");
    expect(resolveMentionDirectory(cwd, "..")).toBe("/repo/src/..");
  });

  it("resolves dot navigation with a nested path", () => {
    expect(resolveMentionDirectory(cwd, "../shared")).toBe("/repo/src/../shared");
    expect(resolveMentionDirectory(cwd, "../..")).toBe("/repo/src/../..");
  });

  it("keeps the cwd containment guard for outside paths", () => {
    expect(isPathInsideCwd(cwd, "/repo/src")).toBe(true);
    expect(isPathInsideCwd(cwd, "/repo/src/a")).toBe(true);
    expect(isPathInsideCwd(cwd, "/repo/src2")).toBe(false);
    expect(isPathInsideCwd(cwd, "/etc")).toBe(false);
    expect(isPathInsideCwd(cwd, "/repo")).toBe(false);
  });
});
