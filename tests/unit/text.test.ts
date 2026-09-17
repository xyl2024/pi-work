import { describe, expect, it } from "vitest";
import { countWords } from "@/lib/client/text";

/**
 * One counter, two footers: the notes editor and the plan detail dialog both
 * report 「字数 · 字符数」 from `countWords`, so its mixed-text convention is what
 * the two readouts agree on.
 */

describe("countWords", () => {
  it("counts every CJK character as one word", () => {
    expect(countWords("整理书架")).toBe(4);
  });

  it("groups latin and digit runs into words", () => {
    expect(countWords("ship 2 notes today")).toBe(4);
  });

  it("counts mixed text by both conventions at once", () => {
    // 今天 = 2 CJK words, then write / 3 / lines = 3 latin runs.
    expect(countWords("今天 write 3 lines")).toBe(2 + 3);
  });

  it("is zero for empty or whitespace-only content", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });
});
