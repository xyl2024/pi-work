import {
  backspace,
  deleteForward,
  insertText,
  moveToOffset,
  normalizeRange,
  offsetOfCursor,
  redo,
  replaceRange,
  undo,
} from "./model";
import { docLength, lineEndOffset, lineStartOffset, offsetToCursor, projectDocText } from "./offsets";
import { nextThinkingLevel } from "@/lib/shared/thinking-level-utils";
import type {
  ComposerHistory,
  ComposerKeyInput,
  ComposerKeyResult,
  ComposerState,
} from "./types";

function edit(state: ComposerState): ComposerKeyResult {
  return { state, effect: "edit" };
}

function withHistory(state: ComposerState, history: ComposerHistory): ComposerState {
  return { ...state, history };
}

function resolveHistory(state: ComposerState, sessionId: string | null | undefined): ComposerHistory {
  const id = sessionId ?? null;
  if (state.history.sessionId === id) return state.history;
  return { sessionId: id, index: null, draft: "" };
}

function withText(state: ComposerState, text: string): ComposerState {
  const { doc, cursorOffset } = replaceRange(
    state.doc,
    { start: 0, end: docLength(state.doc) },
    [{ kind: "text", text }],
  );
  return { ...state, doc, cursor: offsetToCursor(doc, cursorOffset) };
}

function historyPool(history: readonly string[], buffer: string): readonly string[] {
  const needle = buffer.toLowerCase();
  const subset = buffer ? history.filter((entry) => entry.toLowerCase().startsWith(needle)) : history;
  return subset.length > 0 ? subset : history;
}

function historyKey(
  state: ComposerState,
  input: ComposerKeyInput,
  direction: "prev" | "next",
): ComposerKeyResult {
  const history = input.history ?? [];
  const historyState = resolveHistory(state, input.sessionId);
  const base = historyState === state.history ? state : withHistory(state, historyState);
  const text = projectDocText(state.doc);
  const selection = normalizeRange(state, input.selection);
  const collapsed = selection.start === selection.end;

  if (direction === "prev") {
    if (history.length === 0) return { state, effect: "none" };
    const cursorAtStart = collapsed && selection.start === 0;
    if (text.includes("\n") && !cursorAtStart) return { state, effect: "none" };

    if (historyState.index === null) {
      const pool = historyPool(history, text);
      return {
        state: withHistory(
          withText(base, pool[pool.length - 1]),
          { ...historyState, index: 0, draft: text },
        ),
        effect: "history-prev",
      };
    }

    const pool = historyPool(history, historyState.draft);
    const index = Math.min(historyState.index + 1, pool.length - 1);
    return {
      state: withHistory(
        withText(base, pool[pool.length - 1 - index]),
        { ...historyState, index },
      ),
      effect: "history-prev",
    };
  }

  if (historyState.index === null) return { state, effect: "none" };
  const cursorAtEnd = collapsed && selection.end === text.length;
  if (text.includes("\n") && !cursorAtEnd) return { state, effect: "none" };

  const index = historyState.index - 1;
  if (index < 0) {
    return {
      state: withHistory(
        withText(base, historyState.draft),
        { ...historyState, index: null, draft: "" },
      ),
      effect: "history-next",
    };
  }

  const pool = historyPool(history, historyState.draft);
  return {
    state: withHistory(
      withText(base, pool[pool.length - 1 - index]),
      { ...historyState, index },
    ),
    effect: "history-next",
  };
}

const THINKING_DIRECTION = { forward: 1, backward: -1 } as const;

function thinkingKey(state: ComposerState, input: ComposerKeyInput): ComposerKeyResult {
  const available = input.availableThinkingLevels;
  if (!available || available.length === 0) return { state, effect: "none" };
  const level = nextThinkingLevel(
    input.thinkingLevel ?? "off",
    available,
    input.shiftKey ? THINKING_DIRECTION.backward : THINKING_DIRECTION.forward,
  );
  if (!level) return { state, effect: "none" };
  return { state, effect: { type: "thinking", level } };
}

export function reduceComposerKey(state: ComposerState, input: ComposerKeyInput): ComposerKeyResult {
  if (input.isComposing) return { state, effect: "none" };

  const hasModifier = Boolean(input.ctrlKey || input.metaKey);
  const selection = normalizeRange(state, input.selection);

  if (input.key === "Tab") return thinkingKey(state, input);
  if (input.key === "ArrowUp") return historyKey(state, input, "prev");
  if (input.key === "ArrowDown") return historyKey(state, input, "next");

  if (input.key === "Enter") {
    if (hasModifier) return { state, effect: "send" };
    return edit(insertText(state, "\n", selection));
  }

  if (input.key === "Backspace") return edit(backspace(state, selection));
  if (input.key === "Delete") return edit(deleteForward(state, selection));

  if ((input.key === "z" || input.key === "Z") && hasModifier) {
    return edit(input.shiftKey ? redo(state) : undo(state));
  }
  if ((input.key === "y" || input.key === "Y") && hasModifier) {
    return edit(redo(state));
  }

  if (input.key === "ArrowLeft") {
    const target = selection.start !== selection.end ? selection.start : offsetOfCursor(state) - 1;
    return edit(moveToOffset(state, target));
  }

  if (input.key === "ArrowRight") {
    const target = selection.start !== selection.end ? selection.end : offsetOfCursor(state) + 1;
    return edit(moveToOffset(state, target));
  }

  if (input.key === "Home" || input.key === "End") {
    const projected = projectDocText(state.doc);
    const anchor = input.key === "Home" ? selection.start : selection.end;
    const target = input.key === "Home"
      ? lineStartOffset(projected, anchor)
      : lineEndOffset(projected, anchor);
    return edit(moveToOffset(state, target));
  }

  return { state, effect: "none" };
}
