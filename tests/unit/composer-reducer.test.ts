import { describe, expect, it } from "vitest";
import { emptyComposerState, insertText, moveToOffset, offsetOfCursor } from "@/lib/client/composer/model";
import { reduceComposerKey } from "@/lib/client/composer/reducer";
import type { ComposerDoc, ComposerNode, ComposerState } from "@/lib/client/composer/types";

const skill: ComposerNode = { kind: "skill", source: "skill", name: "review", command: "review" };

function typed(value: string, cursor = value.length): ComposerState {
  return moveToOffset(insertText(emptyComposerState(), value), cursor);
}

function withChip(): ComposerState {
  const doc: ComposerDoc = {
    nodes: [
      { kind: "text", text: "a" },
      skill,
      { kind: "text", text: "b" },
    ],
  };
  return { ...emptyComposerState(), doc, cursor: { node: 0, offset: 1 } };
}

describe("composer enter semantics", () => {
  it("inserts a newline on Enter", () => {
    const result = reduceComposerKey(typed("ab", 1), { key: "Enter" });
    expect(result.effect).toBe("edit");
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "a\nb" }]);
    expect(offsetOfCursor(result.state)).toBe(2);
  });

  it("inserts a newline on Shift+Enter", () => {
    const result = reduceComposerKey(typed("ab", 1), { key: "Enter", shiftKey: true });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "a\nb" }]);
  });

  it.each([
    { name: "Ctrl", input: { key: "Enter", ctrlKey: true } },
    { name: "Cmd", input: { key: "Enter", metaKey: true } },
  ])("requests a send on $name+Enter", ({ input }) => {
    const state = typed("hello");
    const result = reduceComposerKey(state, input);
    expect(result.effect).toBe("send");
    expect(result.state).toBe(state);
  });

  it("does not act while composing", () => {
    const state = typed("ni");
    const result = reduceComposerKey(state, { key: "Enter", isComposing: true });
    expect(result.effect).toBe("none");
    expect(result.state).toBe(state);
  });
});

describe("composer deletion keys", () => {
  it("deletes one character on Backspace", () => {
    const result = reduceComposerKey(typed("abc", 2), { key: "Backspace" });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "ac" }]);
    expect(offsetOfCursor(result.state)).toBe(1);
  });

  it("deletes the selected range on Backspace", () => {
    const result = reduceComposerKey(typed("abcdef", 1), {
      key: "Backspace",
      selection: { start: 1, end: 4 },
    });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "aef" }]);
    expect(offsetOfCursor(result.state)).toBe(1);
  });

  it("deletes a whole chip on Shift+Backspace at its right boundary", () => {
    const state = moveToOffset(withChip(), 2);
    const result = reduceComposerKey(state, { key: "Backspace", shiftKey: true });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "ab" }]);
  });

  it("deletes a whole chip on Delete at its left boundary", () => {
    const result = reduceComposerKey(withChip(), { key: "Delete" });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "ab" }]);
  });

  it("does nothing at the start of the document but still consumes the key", () => {
    const state = typed("abc", 0);
    const result = reduceComposerKey(state, { key: "Backspace" });
    expect(result.effect).toBe("edit");
    expect(result.state).toBe(state);
  });
});

describe("composer cursor keys", () => {
  it("moves across a chip on ArrowRight", () => {
    const result = reduceComposerKey(withChip(), { key: "ArrowRight" });
    expect(offsetOfCursor(result.state)).toBe(2);
    expect(result.state.cursor).toEqual({ node: 2, offset: 0 });
  });

  it("moves across a chip on ArrowLeft", () => {
    const state = moveToOffset(withChip(), 2);
    const result = reduceComposerKey(state, { key: "ArrowLeft" });
    expect(offsetOfCursor(result.state)).toBe(1);
  });

  it("collapses a selection to its start on ArrowLeft", () => {
    const result = reduceComposerKey(typed("abcdef", 4), {
      key: "ArrowLeft",
      selection: { start: 2, end: 4 },
    });
    expect(offsetOfCursor(result.state)).toBe(2);
  });

  it("moves to the start and end of the current line", () => {
    const state = typed("hello\nworld", 8);
    expect(offsetOfCursor(reduceComposerKey(state, { key: "Home" }).state)).toBe(6);
    expect(offsetOfCursor(reduceComposerKey(state, { key: "End" }).state)).toBe(11);
  });

  it("leaves history keys for the view", () => {
    const state = typed("hello");
    expect(reduceComposerKey(state, { key: "ArrowUp" }).effect).toBe("none");
    expect(reduceComposerKey(state, { key: "ArrowDown" }).effect).toBe("none");
  });
});

describe("composer undo and redo keys", () => {
  it("undoes on Cmd/Ctrl+Z", () => {
    const state = typed("abc");
    const result = reduceComposerKey(state, { key: "z", ctrlKey: true });
    expect(result.effect).toBe("edit");
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "" }]);
  });

  it("redoes on Cmd/Ctrl+Shift+Z", () => {
    const state = typed("abc");
    const undone = reduceComposerKey(state, { key: "z", metaKey: true }).state;
    const redone = reduceComposerKey(undone, { key: "z", metaKey: true, shiftKey: true });
    expect(redone.state.doc.nodes).toEqual([{ kind: "text", text: "abc" }]);
  });

  it("consumes undo even when there is no history", () => {
    const state = emptyComposerState();
    const result = reduceComposerKey(state, { key: "z", ctrlKey: true });
    expect(result.effect).toBe("edit");
    expect(result.state).toBe(state);
  });
});
