import { describe, expect, it } from "vitest";
import { parseDiffBlock } from "@/lib/shared/diff-block";
import { countDisplayDiffLines, countUnifiedPatchLines } from "@/lib/shared/tool-diff-stats";

const unified = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -10,2 +10,2 @@ section",
  " keep",
  "-old",
  "+new",
].join("\n");

describe("parseDiffBlock", () => {
  it("splits a unified patch into files and classifies lines", () => {
    const result = parseDiffBlock(unified);
    expect(result.renderable).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(2);
    expect(result.files[0].additions).toBe(2);
    expect(result.files[0].deletions).toBe(1);
    expect(result.files[0].newPath).toBe("src/a.ts");
    expect(result.files[1].newPath).toBe("src/b.ts");

    const lines = result.files[0].lines;
    expect(lines[0].type).toBe("file");
    expect(lines[1].type).toBe("meta");
    expect(lines[4].type).toBe("hunk");
    expect(lines[5].type).toBe("context");
    expect(lines[6].type).toBe("del");
    expect(lines[7].type).toBe("add");
  });

  it("tracks old and new line numbers per file", () => {
    const result = parseDiffBlock(unified);
    const lines = result.files[0].lines;
    expect(lines[5]).toMatchObject({ type: "context", oldLine: 1, newLine: 1 });
    expect(lines[6]).toMatchObject({ type: "del", oldLine: 2 });
    expect(lines[6].newLine).toBeUndefined();
    expect(lines[7]).toMatchObject({ type: "add", newLine: 2 });
    expect(lines[7].oldLine).toBeUndefined();
    expect(lines[9]).toMatchObject({ type: "context", oldLine: 3, newLine: 4 });

    const second = result.files[1].lines;
    expect(second[3]).toMatchObject({ type: "hunk", oldStart: 10 });
    expect(second[4]).toMatchObject({ type: "context", oldLine: 10, newLine: 10 });
  });

  it("parses hunk ranges", () => {
    const result = parseDiffBlock(unified);
    const hunk = result.files[0].lines[4];
    expect(hunk.type).toBe("hunk");
    expect(hunk).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 });
    const hunk2 = result.files[1].lines[3];
    expect(hunk2).toMatchObject({ oldStart: 10, oldCount: 2, newStart: 10, newCount: 2 });
  });

  it("handles a bare +/- fragment without hunk headers", () => {
    const result = parseDiffBlock("plain line\n-removed\n+added\n");
    expect(result.renderable).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    const lines = result.files[0].lines;
    expect(lines[0].type).toBe("context");
    expect(lines[0].oldLine).toBeUndefined();
    expect(lines[0].newLine).toBeUndefined();
    expect(lines[1].type).toBe("del");
    expect(lines[2].type).toBe("add");
  });

  it("handles renames and new files", () => {
    const rename = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "-x",
      "+y",
    ].join("\n");
    const result = parseDiffBlock(rename);
    expect(result.files[0].oldPath).toBe("old.ts");
    expect(result.files[0].newPath).toBe("new.ts");

    const created = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "+hello",
    ].join("\n");
    const createdResult = parseDiffBlock(created);
    expect(createdResult.files[0].oldPath).toBeNull();
    expect(createdResult.files[0].newPath).toBe("new.ts");
    expect(createdResult.files[0].additions).toBe(1);
  });

  it("drops no-newline markers and keeps empty and unknown lines", () => {
    const result = parseDiffBlock(
      ["+a", "\\ No newline at end of file", "", "??? weird", "-b"].join("\n"),
    );
    const types = result.files[0].lines.map((l) => l.type);
    expect(types).toEqual(["add", "meta", "context", "context", "del"]);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it("reports hasHunks based on presence of @@ headers", () => {
    expect(parseDiffBlock(unified).hasHunks).toBe(true);
    expect(parseDiffBlock("plain\n-removed\n+added\n").hasHunks).toBe(false);
    expect(parseDiffBlock("just text\n").hasHunks).toBe(false);
  });

  it("marks binary files with no body lines", () => {
    const binary = [
      "diff --git a/logo.png b/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "diff --git a/app.ts b/app.ts",
      "+++ b/app.ts",
      "+x",
    ].join("\n");
    const result = parseDiffBlock(binary);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].lines.filter((l) => l.type === "add" || l.type === "del")).toHaveLength(0);
    expect(result.files[0].newPath).toBe("logo.png");
  });

  it("falls back when there is no add or delete line", () => {
    const result = parseDiffBlock("just some\nplain text\n@@ -1,2 +1,2 @@\n");
    expect(result.renderable).toBe(false);
    expect(result.files).toHaveLength(0);
  });

  it("falls back on empty input", () => {
    expect(parseDiffBlock("").renderable).toBe(false);
    expect(parseDiffBlock("   \n  \n").renderable).toBe(false);
  });

  it("computes overall stats from countUnifiedPatchLines for hunk-bearing patches", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " const d = 5;",
    ].join("\n");
    const result = parseDiffBlock(patch);
    expect(result.additions).toBe(countUnifiedPatchLines(patch).additions);
    expect(result.deletions).toBe(countUnifiedPatchLines(patch).deletions);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
  });

  it("excludes ---/+++ metadata from stats in fragments without hunks", () => {
    const fragment = [
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ b/old.ts",
      "-x",
      "+y",
    ].join("\n");
    const result = parseDiffBlock(fragment);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.additions).toBe(countDisplayDiffLines("-x\n+y").additions);
  });

  it("sums stats across file segments", () => {
    const result = parseDiffBlock(unified);
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(2);
  });

  it("falls back on malformed hunk-only content", () => {
    const result = parseDiffBlock("@@@ broken @@@\n");
    expect(result.renderable).toBe(false);
  });
});
