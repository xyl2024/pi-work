import { describe, expect, it } from "vitest";
import {
  cursorToOffset,
  offsetToCursor,
  projectDocText,
  textAfterCursor,
  textBeforeCursor,
} from "@/lib/client/composer/offsets";
import type { ComposerDoc, ComposerNode } from "@/lib/client/composer/types";

const skill: ComposerNode = { kind: "skill", source: "skill", name: "review", command: "review" };
const doc: ComposerDoc = {
  nodes: [
    { kind: "text", text: "ab" },
    skill,
    { kind: "text", text: "cd" },
  ],
};

describe("composer logical offsets", () => {
  it("counts each chip as one unit", () => {
    expect(cursorToOffset(doc, { node: 0, offset: 2 })).toBe(2);
    expect(cursorToOffset(doc, { node: 1, offset: 0 })).toBe(2);
    expect(cursorToOffset(doc, { node: 1, offset: 1 })).toBe(3);
    expect(cursorToOffset(doc, { node: 2, offset: 0 })).toBe(3);
    expect(cursorToOffset(doc, { node: 2, offset: 2 })).toBe(5);
  });

  it("maps an offset before a chip back to the preceding text end", () => {
    expect(offsetToCursor(doc, 2)).toEqual({ node: 0, offset: 2 });
  });

  it("maps an offset after a chip to the following text start", () => {
    expect(offsetToCursor(doc, 3)).toEqual({ node: 2, offset: 0 });
  });

  it("clamps offsets outside the document", () => {
    expect(offsetToCursor(doc, -4)).toEqual({ node: 0, offset: 0 });
    expect(offsetToCursor(doc, 99)).toEqual({ node: 2, offset: 2 });
  });

  it("treats chips as separators in text projections", () => {
    expect(projectDocText(doc)).toBe("ab cd");
    expect(textBeforeCursor(doc, { node: 1, offset: 1 })).toBe("ab ");
    expect(textAfterCursor(doc, { node: 1, offset: 1 })).toBe("cd");
  });
});
