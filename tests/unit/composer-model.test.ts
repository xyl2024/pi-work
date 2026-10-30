import { describe, expect, it } from "vitest";
import {
  backspace,
  deleteForward,
  deleteRange,
  emptyComposerState,
  insertNode,
  insertNodes,
  insertText,
  offsetOfCursor,
  redo,
  moveToOffset,
  removeImage,
  undo,
} from "@/lib/client/composer/model";
import type { ComposerDoc, ComposerNode } from "@/lib/client/composer/types";

function text(value: string): ComposerNode {
  return { kind: "text", text: value };
}

function skill(name = "review"): ComposerNode {
  return { kind: "skill", source: "skill", name, command: name };
}

function docOf(...nodes: ComposerNode[]): ComposerDoc {
  return { nodes };
}

describe("composer text editing", () => {
  it("inserts text into an empty composer", () => {
    const state = insertText(emptyComposerState(), "hello", { start: 0, end: 0 });
    expect(state.doc).toEqual(docOf(text("hello")));
    expect(offsetOfCursor(state)).toBe(5);
  });

  it("inserts text at the logical cursor", () => {
    const state = moveToOffset(insertText(emptyComposerState(), "abcd"), 2);
    const next = insertText(state, "XY");
    expect(next.doc).toEqual(docOf(text("abXYcd")));
    expect(offsetOfCursor(next)).toBe(4);
  });

  it("replaces a selected range", () => {
    const state = insertText(emptyComposerState(), "abc");
    const next = insertText(state, "X", { start: 1, end: 2 });
    expect(next.doc).toEqual(docOf(text("aXc")));
    expect(offsetOfCursor(next)).toBe(2);
  });

  it("deletes a range that spans chips and text", () => {
    const state = {
      ...emptyComposerState(),
      doc: docOf(text("hello "), skill(), text(" world")),
    };
    const next = deleteRange(state, { start: 4, end: 8 });
    expect(next.doc).toEqual(docOf(text("hellworld")));
    expect(offsetOfCursor(next)).toBe(4);
  });

  it("deletes a whole chip on backspace at its right boundary", () => {
    const state = moveToOffset(
      { ...emptyComposerState(), doc: docOf(text("a"), skill(), text("b")) },
      2,
    );
    const next = backspace(state);
    expect(next.doc).toEqual(docOf(text("ab")));
    expect(offsetOfCursor(next)).toBe(1);
  });

  it("keeps the preceding character when backspacing at a chip's left boundary", () => {
    const state = moveToOffset(
      { ...emptyComposerState(), doc: docOf(text("a"), skill(), text("b")) },
      1,
    );
    const next = backspace(state);
    expect(next.doc).toEqual(docOf(skill(), text("b")));
  });

  it("deletes a whole chip on forward delete at its left boundary", () => {
    const state = moveToOffset(
      { ...emptyComposerState(), doc: docOf(text("a"), skill(), text("b")) },
      1,
    );
    const next = deleteForward(state);
    expect(next.doc).toEqual(docOf(text("ab")));
    expect(offsetOfCursor(next)).toBe(1);
  });

  it("inserts a chip and places the cursor after it", () => {
    const state = moveToOffset(insertText(emptyComposerState(), "abc"), 1);
    const next = insertNode(state, skill());
    expect(next.doc).toEqual(docOf(text("a"), skill(), text("bc")));
    expect(offsetOfCursor(next)).toBe(2);
  });

  it("normalizes empty and adjacent text nodes after deletion", () => {
    const state = { ...emptyComposerState(), doc: docOf(text("ab"), text("cd")) };
    const next = deleteRange(state, { start: 0, end: 4 });
    expect(next.doc).toEqual(docOf(text("")));
  });
});

describe("composer undo and redo", () => {
  it("restores the previous document and cursor", () => {
    const state = insertText(emptyComposerState(), "abc");
    const undone = undo(state);
    expect(undone.doc).toEqual(docOf(text("")));
    expect(offsetOfCursor(undone)).toBe(0);
  });

  it("reapplies an undone edit", () => {
    const state = insertText(emptyComposerState(), "abc");
    const redone = redo(undo(state));
    expect(redone.doc).toEqual(docOf(text("abc")));
    expect(offsetOfCursor(redone)).toBe(3);
  });

  it("drops the redo stack after a new edit", () => {
    const state = insertText(emptyComposerState(), "abc");
    const afterUndo = undo(state);
    const afterEdit = insertText(afterUndo, "x");
    expect(redo(afterEdit).doc).toEqual(afterEdit.doc);
  });
});

function image(id: string): ComposerNode {
  return { kind: "image", id, data: `data-${id}`, mimeType: "image/png", previewUrl: `blob:${id}` };
}

describe("composer image chips", () => {
  it("inserts multiple images at the cursor in insertion order", () => {
    const state = moveToOffset(insertText(emptyComposerState(), "ab"), 1);
    const next = insertNodes(state, [image("one"), image("two")]);
    expect(next.doc).toEqual(docOf(text("a"), image("one"), image("two"), text("b")));
    expect(offsetOfCursor(next)).toBe(3);
  });

  it("inserts an image into an empty composer", () => {
    const next = insertNode(emptyComposerState(), image("one"));
    expect(next.doc).toEqual(docOf(image("one")));
    expect(offsetOfCursor(next)).toBe(1);
  });

  it("deletes an image chip on backspace at its right boundary", () => {
    const state = moveToOffset(
      { ...emptyComposerState(), doc: docOf(text("a"), image("one"), text("b")) },
      2,
    );
    const next = backspace(state);
    expect(next.doc).toEqual(docOf(text("ab")));
    expect(offsetOfCursor(next)).toBe(1);
  });

  it("deletes only the targeted image chip", () => {
    const state = { ...emptyComposerState(), doc: docOf(image("one"), image("two"), text("x")) };
    const next = removeImage(state, "one");
    expect(next.doc).toEqual(docOf(image("two"), text("x")));
    expect(offsetOfCursor(next)).toBe(0);
  });

  it("leaves the document untouched when removing an unknown image", () => {
    const state = { ...emptyComposerState(), doc: docOf(image("one")) };
    expect(removeImage(state, "missing")).toBe(state);
  });

  it("restores a removed image on undo", () => {
    const state = { ...emptyComposerState(), doc: docOf(image("one"), text("x")) };
    expect(undo(removeImage(state, "one")).doc).toEqual(state.doc);
  });
});
