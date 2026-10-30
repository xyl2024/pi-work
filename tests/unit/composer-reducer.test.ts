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

describe("composer history keys", () => {
  const history = ["first message", "second message", "third message"];

  it("walks from the newest message backwards on ArrowUp", () => {
    const start = reduceComposerKey(typed("draft"), { key: "ArrowUp", history });
    expect(start.effect).toBe("history-prev");
    expect(start.state.doc.nodes).toEqual([{ kind: "text", text: "third message" }]);
    expect(offsetOfCursor(start.state)).toBe("third message".length);

    const older = reduceComposerKey(start.state, { key: "ArrowUp", history });
    expect(older.state.doc.nodes).toEqual([{ kind: "text", text: "second message" }]);
    expect(offsetOfCursor(older.state)).toBe("second message".length);

    const oldest = reduceComposerKey(older.state, { key: "ArrowUp", history });
    expect(oldest.state.doc.nodes).toEqual([{ kind: "text", text: "first message" }]);

    const stuck = reduceComposerKey(oldest.state, { key: "ArrowUp", history });
    expect(stuck.effect).toBe("history-prev");
    expect(stuck.state.doc.nodes).toEqual([{ kind: "text", text: "first message" }]);
  });

  it("restores the pre-history draft on ArrowDown past the oldest entry", () => {
    const start = reduceComposerKey(typed("my draft"), { key: "ArrowUp", history });
    const older = reduceComposerKey(start.state, { key: "ArrowUp", history });
    const oldest = reduceComposerKey(older.state, { key: "ArrowUp", history });
    const restored = reduceComposerKey(oldest.state, { key: "ArrowDown", history });
    expect(restored.effect).toBe("history-next");
    expect(restored.state.doc.nodes).toEqual([{ kind: "text", text: "second message" }]);

    const back = reduceComposerKey(
      reduceComposerKey(restored.state, { key: "ArrowDown", history }).state,
      { key: "ArrowDown", history },
    );
    expect(back.effect).toBe("history-next");
    expect(back.state.doc.nodes).toEqual([{ kind: "text", text: "my draft" }]);
    expect(offsetOfCursor(back.state)).toBe("my draft".length);

    expect(reduceComposerKey(back.state, { key: "ArrowDown", history }).effect).toBe("none");
  });

  it("filters history by a case-insensitive prefix of the current buffer", () => {
    const filteredHistory = ["alpha one", "beta", "Alpha two"];
    const start = reduceComposerKey(typed("al"), { key: "ArrowUp", history: filteredHistory });
    expect(start.state.doc.nodes).toEqual([{ kind: "text", text: "Alpha two" }]);
    const older = reduceComposerKey(start.state, { key: "ArrowUp", history: filteredHistory });
    expect(older.state.doc.nodes).toEqual([{ kind: "text", text: "alpha one" }]);
  });

  it("falls back to the full history when the prefix subset is empty", () => {
    const result = reduceComposerKey(typed("zzz"), { key: "ArrowUp", history });
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "third message" }]);
  });

  it("does not steal ArrowUp in a multi-line draft away from the line start", () => {
    const state = typed("line one\nline two", 12);
    expect(reduceComposerKey(state, { key: "ArrowUp", history }).effect).toBe("none");
    expect(reduceComposerKey(state, { key: "ArrowUp", history }).state).toBe(state);
  });

  it("still navigates history from the very start of a multi-line draft", () => {
    const state = typed("line one\nline two", 0);
    const result = reduceComposerKey(state, { key: "ArrowUp", history });
    expect(result.effect).toBe("history-prev");
    expect(result.state.doc.nodes).toEqual([{ kind: "text", text: "third message" }]);
  });

  it("does not steal arrows while composing", () => {
    const state = typed("ni");
    expect(reduceComposerKey(state, { key: "ArrowUp", history, isComposing: true }).effect).toBe("none");
    expect(reduceComposerKey(state, { key: "ArrowDown", history, isComposing: true }).effect).toBe("none");
  });

  it("resets navigation when the session changes", () => {
    const start = reduceComposerKey(typed("draft"), { key: "ArrowUp", history, sessionId: "one" });
    const older = reduceComposerKey(start.state, { key: "ArrowUp", history, sessionId: "one" });
    expect(older.state.doc.nodes).toEqual([{ kind: "text", text: "second message" }]);

    expect(reduceComposerKey(older.state, { key: "ArrowDown", history, sessionId: "one" }).effect).toBe("history-next");
    const switched = reduceComposerKey(older.state, { key: "ArrowDown", history, sessionId: "two" });
    expect(switched.effect).toBe("none");
    expect(switched.state).toBe(older.state);
  });
});

describe("composer thinking level keys", () => {
  const availableThinkingLevels = ["off", "low", "high"];

  it("cycles forward on Tab and wraps around", () => {
    const low = reduceComposerKey(typed(""), {
      key: "Tab",
      thinkingLevel: "off",
      availableThinkingLevels,
    });
    expect(low.effect).toEqual({ type: "thinking", level: "low" });

    const high = reduceComposerKey(typed(""), {
      key: "Tab",
      thinkingLevel: "low",
      availableThinkingLevels,
    });
    expect(high.effect).toEqual({ type: "thinking", level: "high" });

    const wrapped = reduceComposerKey(typed(""), {
      key: "Tab",
      thinkingLevel: "high",
      availableThinkingLevels,
    });
    expect(wrapped.effect).toEqual({ type: "thinking", level: "off" });
  });

  it("cycles backward on Shift+Tab and wraps around", () => {
    const off = reduceComposerKey(typed(""), {
      key: "Tab",
      shiftKey: true,
      thinkingLevel: "low",
      availableThinkingLevels,
    });
    expect(off.effect).toEqual({ type: "thinking", level: "off" });

    const wrapped = reduceComposerKey(typed(""), {
      key: "Tab",
      shiftKey: true,
      thinkingLevel: "off",
      availableThinkingLevels,
    });
    expect(wrapped.effect).toEqual({ type: "thinking", level: "high" });
  });

  it("skips levels the current model does not support", () => {
    const result = reduceComposerKey(typed(""), {
      key: "Tab",
      thinkingLevel: "off",
      availableThinkingLevels: ["high", "off", "medium"],
    });
    expect(result.effect).toEqual({ type: "thinking", level: "medium" });
  });

  it("does not act when there are no available levels", () => {
    const state = typed("hello");
    expect(reduceComposerKey(state, { key: "Tab", thinkingLevel: "off" }).effect).toBe("none");
    expect(reduceComposerKey(state, { key: "Tab", availableThinkingLevels: [] }).effect).toBe("none");
    expect(reduceComposerKey(state, { key: "Tab", availableThinkingLevels: [] }).state).toBe(state);
  });

  it("does not act while composing", () => {
    const state = typed("hello");
    expect(reduceComposerKey(state, {
      key: "Tab",
      thinkingLevel: "off",
      availableThinkingLevels,
      isComposing: true,
    }).effect).toBe("none");
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
