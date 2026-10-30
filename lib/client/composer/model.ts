import { docLength, nodeLength, offsetToCursor } from "./offsets";
import type {
  ComposerDoc,
  ComposerNode,
  ComposerRange,
  ComposerSnapshot,
  ComposerState,
  Cursor,
} from "./types";

const HISTORY_LIMIT = 100;

export function emptyDoc(): ComposerDoc {
  return { nodes: [{ kind: "text", text: "" }] };
}

export function emptyComposerState(): ComposerState {
  return { doc: emptyDoc(), cursor: { node: 0, offset: 0 }, past: [], future: [] };
}

export function normalizeDoc(doc: ComposerDoc): ComposerDoc {
  const nodes: ComposerNode[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "text") {
      if (node.text.length === 0) continue;
      const previous = nodes[nodes.length - 1];
      if (previous?.kind === "text") {
        nodes[nodes.length - 1] = { kind: "text", text: previous.text + node.text };
      } else {
        nodes.push({ kind: "text", text: node.text });
      }
    } else {
      nodes.push(node);
    }
  }
  return { nodes: nodes.length ? nodes : [{ kind: "text", text: "" }] };
}

export function snapshotState(state: ComposerState): ComposerSnapshot {
  return { doc: state.doc, cursor: state.cursor };
}

export function sameCursor(a: Cursor, b: Cursor): boolean {
  return a.node === b.node && a.offset === b.offset;
}

export function commitSnapshot(state: ComposerState, snapshot: ComposerSnapshot): ComposerState {
  if (snapshot.doc === state.doc && sameCursor(snapshot.cursor, state.cursor)) return state;
  const past = [...state.past, snapshotState(state)];
  return {
    doc: snapshot.doc,
    cursor: snapshot.cursor,
    past: past.slice(Math.max(0, past.length - HISTORY_LIMIT)),
    future: [],
  };
}

export function setCursor(state: ComposerState, cursor: Cursor): ComposerState {
  if (sameCursor(state.cursor, cursor)) return state;
  return { ...state, cursor };
}

export function moveToOffset(state: ComposerState, offset: number): ComposerState {
  const bounded = Math.max(0, Math.min(offset, docLength(state.doc)));
  return setCursor(state, offsetToCursor(state.doc, bounded));
}

export function normalizeRange(state: ComposerState, range?: ComposerRange): ComposerRange {
  const fallback = offsetOfCursor(state);
  const start = Math.max(0, Math.min(range?.start ?? fallback, docLength(state.doc)));
  const end = Math.max(0, Math.min(range?.end ?? fallback, docLength(state.doc)));
  return start <= end ? { start, end } : { start: end, end: start };
}

export function offsetOfCursor(state: ComposerState): number {
  return cursorOffset(state.doc, state.cursor);
}

function cursorOffset(doc: ComposerDoc, cursor: Cursor): number {
  let offset = 0;
  for (let index = 0; index < doc.nodes.length; index += 1) {
    const node = doc.nodes[index];
    if (index === cursor.node) return offset + Math.max(0, Math.min(cursor.offset, nodeLength(node)));
    offset += nodeLength(node);
  }
  return offset;
}

function splitDocAt(doc: ComposerDoc, offset: number): { left: ComposerNode[]; right: ComposerNode[] } {
  const left: ComposerNode[] = [];
  const right: ComposerNode[] = [];
  let consumed = 0;

  for (const node of doc.nodes) {
    const length = nodeLength(node);
    if (offset <= consumed) {
      right.push(node);
      continue;
    }
    if (offset >= consumed + length) {
      left.push(node);
      consumed += length;
      continue;
    }
    const cut = offset - consumed;
    if (node.kind === "text") {
      left.push({ kind: "text", text: node.text.slice(0, cut) });
      right.push({ kind: "text", text: node.text.slice(cut) });
    }
    consumed += length;
  }

  return { left, right };
}

export function replaceRange(
  doc: ComposerDoc,
  range: ComposerRange,
  replacement: ComposerNode[],
): { doc: ComposerDoc; cursorOffset: number } {
  const total = docLength(doc);
  const start = Math.max(0, Math.min(range.start, total));
  const end = Math.max(0, Math.min(range.end, total));
  const left = splitDocAt(doc, start).left;
  const right = splitDocAt(doc, end).right;
  const nextDoc = normalizeDoc({ nodes: [...left, ...replacement, ...right] });
  const cursorOffset = start + replacement.reduce((sum, node) => sum + nodeLength(node), 0);
  return { doc: nextDoc, cursorOffset };
}

function commitEdit(state: ComposerState, doc: ComposerDoc, cursorOffset: number): ComposerState {
  const cursor = offsetToCursor(doc, cursorOffset);
  return commitSnapshot(state, { doc, cursor });
}

export function insertText(state: ComposerState, text: string, range?: ComposerRange): ComposerState {
  if (text.length === 0) return state;
  const { doc, cursorOffset } = replaceRange(state.doc, normalizeRange(state, range), [
    { kind: "text", text },
  ]);
  return commitEdit(state, doc, cursorOffset);
}

export function insertNode(
  state: ComposerState,
  node: ComposerNode,
  range?: ComposerRange,
): ComposerState {
  const { doc, cursorOffset } = replaceRange(state.doc, normalizeRange(state, range), [node]);
  return commitEdit(state, doc, cursorOffset);
}

export function deleteRange(state: ComposerState, range?: ComposerRange): ComposerState {
  const normalized = normalizeRange(state, range);
  if (normalized.start === normalized.end) return state;
  const { doc, cursorOffset } = replaceRange(state.doc, normalized, []);
  return commitEdit(state, doc, cursorOffset);
}

export function backspace(state: ComposerState, range?: ComposerRange): ComposerState {
  const normalized = normalizeRange(state, range);
  if (normalized.start !== normalized.end) return deleteRange(state, normalized);
  if (normalized.start === 0) return state;
  return deleteRange(state, { start: normalized.start - 1, end: normalized.start });
}

export function deleteForward(state: ComposerState, range?: ComposerRange): ComposerState {
  const normalized = normalizeRange(state, range);
  if (normalized.start !== normalized.end) return deleteRange(state, normalized);
  if (normalized.start >= docLength(state.doc)) return state;
  return deleteRange(state, { start: normalized.start, end: normalized.start + 1 });
}

export function undo(state: ComposerState): ComposerState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    doc: previous.doc,
    cursor: previous.cursor,
    past: state.past.slice(0, -1),
    future: [snapshotState(state), ...state.future],
  };
}

export function redo(state: ComposerState): ComposerState {
  if (state.future.length === 0) return state;
  const next = state.future[0];
  return {
    doc: next.doc,
    cursor: next.cursor,
    past: [...state.past, snapshotState(state)],
    future: state.future.slice(1),
  };
}
