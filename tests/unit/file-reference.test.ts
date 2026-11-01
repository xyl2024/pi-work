import { describe, expect, it } from "vitest";
import { formatFilePathReference } from "@/lib/shared/file-reference";

describe("file path reference formatting", () => {
  it("wraps a cwd-relative path in a code span with a trailing space", () => {
    expect(formatFilePathReference("src/app.ts")).toBe("`./src/app.ts` ");
  });

  it("does not duplicate an existing relative prefix", () => {
    expect(formatFilePathReference("./README.md")).toBe("`./README.md` ");
  });

  it("widens the fence when the path itself contains backticks", () => {
    expect(formatFilePathReference("docs/a`b.md")).toBe("``./docs/a`b.md`` ");
  });

  it("normalizes Windows separators", () => {
    expect(formatFilePathReference("src\\app.ts")).toBe("`./src/app.ts` ");
  });
});
