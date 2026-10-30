import type { ComposerDoc, ComposerNode, Cursor } from "./types";

export function nodeLength(node: ComposerNode): number {
  return node.kind === "text" ? node.text.length : 1;
}

export function docLength(doc: ComposerDoc): number {
  return doc.nodes.reduce((total, node) => total + nodeLength(node), 0);
}

export function cursorToOffset(doc: ComposerDoc, cursor: Cursor): number {
  let offset = 0;
  for (let index = 0; index < doc.nodes.length; index += 1) {
    const node = doc.nodes[index];
    if (index === cursor.node) {
      return offset + Math.max(0, Math.min(cursor.offset, nodeLength(node)));
    }
    offset += nodeLength(node);
  }
  return offset;
}

export function offsetToCursor(doc: ComposerDoc, offset: number): Cursor {
  const target = Math.max(0, Math.min(offset, docLength(doc)));
  let consumed = 0;

  for (let index = 0; index < doc.nodes.length; index += 1) {
    const node = doc.nodes[index];
    const length = nodeLength(node);

    if (target === consumed) {
      if (node.kind === "text") return { node: index, offset: 0 };
      const previous = doc.nodes[index - 1];
      if (previous?.kind === "text") return { node: index - 1, offset: previous.text.length };
      return { node: index, offset: 0 };
    }

    if (target < consumed + length) {
      return { node: index, offset: target - consumed };
    }

    if (target === consumed + length) {
      if (node.kind === "text") return { node: index, offset: length };
      const next = doc.nodes[index + 1];
      if (next?.kind === "text") return { node: index + 1, offset: 0 };
      return { node: index, offset: 1 };
    }

    consumed += length;
  }

  const last = doc.nodes.length - 1;
  if (last < 0) return { node: 0, offset: 0 };
  return { node: last, offset: nodeLength(doc.nodes[last]) };
}

export function projectDocText(doc: ComposerDoc): string {
  return doc.nodes.map((node) => (node.kind === "text" ? node.text : " ")).join("");
}

export function textBeforeCursor(doc: ComposerDoc, cursor: Cursor): string {
  return projectDocText(doc).slice(0, cursorToOffset(doc, cursor));
}

export function textAfterCursor(doc: ComposerDoc, cursor: Cursor): string {
  return projectDocText(doc).slice(cursorToOffset(doc, cursor));
}

export function lineStartOffset(text: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, text.length));
  return text.lastIndexOf("\n", bounded - 1) + 1;
}

export function lineEndOffset(text: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const nextBreak = text.indexOf("\n", bounded);
  return nextBreak === -1 ? text.length : nextBreak;
}
