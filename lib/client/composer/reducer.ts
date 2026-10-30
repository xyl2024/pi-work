import {
  backspace,
  deleteForward,
  insertText,
  moveToOffset,
  normalizeRange,
  offsetOfCursor,
  redo,
  undo,
} from "./model";
import { lineEndOffset, lineStartOffset, projectDocText } from "./offsets";
import type { ComposerKeyInput, ComposerKeyResult, ComposerState } from "./types";

function edit(state: ComposerState): ComposerKeyResult {
  return { state, effect: "edit" };
}

export function reduceComposerKey(state: ComposerState, input: ComposerKeyInput): ComposerKeyResult {
  if (input.isComposing) return { state, effect: "none" };

  const hasModifier = Boolean(input.ctrlKey || input.metaKey);
  const selection = normalizeRange(state, input.selection);

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
