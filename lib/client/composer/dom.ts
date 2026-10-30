import type { ComposerDoc, ComposerNode, ComposerRange, ComposerSkillNode, Cursor } from "./types";
import { cursorToOffset } from "./offsets";

export interface ComposerLabels {
  skill: (node: ComposerSkillNode) => string;
  file: (path: string) => string;
  image: (id: string) => string;
}

function isChip(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
    && (node as HTMLElement).hasAttribute("data-composer-kind");
}

function isBreak(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR";
}

function isChipKind(element: HTMLElement, kind: string): boolean {
  return element.getAttribute("data-composer-kind") === kind;
}

function chipLabel(node: ComposerNode, labels: ComposerLabels): string {
  if (node.kind === "skill") return labels.skill(node);
  if (node.kind === "file") return labels.file(node.relativePath);
  if (node.kind === "image") return labels.image(node.id);
  return node.text;
}

function createChip(node: ComposerNode, labels: ComposerLabels): HTMLElement {
  const element = document.createElement("span");
  element.setAttribute("contenteditable", "false");
  element.className = "composer-chip";
  element.setAttribute("data-composer-kind", node.kind);
  element.setAttribute("aria-label", chipLabel(node, labels));

  if (node.kind === "skill") {
    element.setAttribute("data-name", node.name);
    element.setAttribute("data-command", node.command);
    element.setAttribute("data-source", node.source);
    element.setAttribute("title", node.source);
    element.textContent = node.name;
  } else if (node.kind === "file") {
    element.setAttribute("data-path", node.relativePath);
    element.setAttribute("title", node.relativePath);
    element.textContent = node.relativePath;
  } else if (node.kind === "image") {
    element.setAttribute("data-id", node.id);
    element.setAttribute("data-preview-url", node.previewUrl);
    element.classList.add("composer-chip-image");
    const image = document.createElement("img");
    image.src = node.previewUrl;
    image.alt = chipLabel(node, labels);
    element.append(image);
  } else {
    element.textContent = node.text;
  }

  return element;
}

export function writeDoc(container: HTMLElement, doc: ComposerDoc, labels: ComposerLabels): void {
  const fragment = document.createDocumentFragment();
  for (const node of doc.nodes) {
    if (node.kind === "text") {
      if (node.text.length > 0) fragment.append(document.createTextNode(node.text));
    } else {
      fragment.append(createChip(node, labels));
    }
  }
  container.replaceChildren(fragment);
}

function readNode(element: HTMLElement): ComposerNode | null {
  if (isChip(element)) {
    const kind = element.getAttribute("data-composer-kind");
    if (kind === "skill") {
      return {
        kind: "skill",
        source: element.getAttribute("data-source") === "action" ? "action" : "skill",
        name: element.getAttribute("data-name") ?? "",
        command: element.getAttribute("data-command") ?? "",
      };
    }
    if (kind === "file") return { kind: "file", relativePath: element.getAttribute("data-path") ?? "" };
    if (kind === "image") {
      return {
        kind: "image",
        id: element.getAttribute("data-id") ?? "",
        previewUrl: element.getAttribute("data-preview-url") ?? "",
      };
    }
    return null;
  }
  return null;
}

function readChildren(parent: Node): ComposerNode[] {
  const nodes: ComposerNode[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push({ kind: "text", text: child.textContent ?? "" });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const chip = readNode(element);
    if (chip) {
      nodes.push(chip);
      continue;
    }
    if (element.tagName === "BR") {
      nodes.push({ kind: "text", text: "\n" });
      continue;
    }
    const nested = readChildren(element);
    if ((element.tagName === "DIV" || element.tagName === "P") && nodes.length > 0) {
      nodes.push({ kind: "text", text: "\n" });
    }
    nodes.push(...nested);
  }
  return nodes;
}

export function readDoc(container: HTMLElement): ComposerDoc {
  return { nodes: readChildren(container) };
}

function wholeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (isChip(node)) return 1;
  if (isBreak(node)) return 1;
  if (node.nodeType === Node.ELEMENT_NODE) {
    return Array.from(node.childNodes).reduce((sum, child) => sum + wholeLength(child), 0);
  }
  return 0;
}

function offsetOfBoundary(container: HTMLElement, boundary: Node, boundaryOffset: number): number {
  let offset = 0;

  if (boundary === container) {
    const children = Array.from(container.childNodes);
    for (let index = 0; index < boundaryOffset && index < children.length; index += 1) {
      offset += wholeLength(children[index]);
    }
    return offset;
  }

  const walk = (parent: Node): boolean => {
    for (const child of Array.from(parent.childNodes)) {
      if (child === boundary) {
        if (child.nodeType === Node.TEXT_NODE) {
          offset += Math.max(0, Math.min(boundaryOffset, child.textContent?.length ?? 0));
          return true;
        }
        if (isChip(child) || isBreak(child)) {
          offset += boundaryOffset === 0 ? 0 : 1;
          return true;
        }
        if (boundaryOffset === 0) return true;
        offset += wholeLength(child);
        return true;
      }
      if (child.nodeType === Node.ELEMENT_NODE && child.contains(boundary)) {
        if (isChip(child)) {
          offset += 1;
          return true;
        }
        return walk(child);
      }
      offset += wholeLength(child);
    }
    return false;
  };

  walk(container);
  return offset;
}

export function readSelection(container: HTMLElement): ComposerRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const start = offsetOfBoundary(container, range.startContainer, range.startOffset);
  const end = offsetOfBoundary(container, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

function pointAtOffset(container: HTMLElement, offset: number): { node: Node; offset: number } {
  let consumed = 0;

  const locate = (parent: Node): { node: Node; offset: number } | null => {
    const children = Array.from(parent.childNodes);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (offset <= consumed + length) {
          return { node: child, offset: Math.max(0, offset - consumed) };
        }
        consumed += length;
        continue;
      }
      if (isChip(child) || isBreak(child)) {
        if (offset === consumed) return { node: parent, offset: index };
        if (offset === consumed + 1) {
          const next = children[index + 1];
          if (next?.nodeType === Node.TEXT_NODE) return { node: next, offset: 0 };
          return { node: parent, offset: index + 1 };
        }
        consumed += 1;
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const nested = locate(child);
        if (nested) return nested;
      }
    }
    return null;
  };

  const located = locate(container);
  if (located) return located;

  if (container.childNodes.length === 0) return { node: container, offset: 0 };
  const last = container.childNodes[container.childNodes.length - 1];
  if (last.nodeType === Node.TEXT_NODE) {
    return { node: last, offset: last.textContent?.length ?? 0 };
  }
  return { node: container, offset: container.childNodes.length };
}

export function writeSelection(container: HTMLElement, range: ComposerRange): void {
  const selection = window.getSelection();
  if (!selection) return;
  const start = pointAtOffset(container, range.start);
  const end = pointAtOffset(container, range.end);
  const next = document.createRange();
  next.setStart(start.node, start.offset);
  next.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(next);
}

export function restoreCursor(container: HTMLElement, cursor: Cursor, doc: ComposerDoc): void {
  const offset = cursorToOffset(doc, cursor);
  writeSelection(container, { start: offset, end: offset });
}

export function isChipElement(node: Node | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  return isChipKind(node, "skill") || isChipKind(node, "file") || isChipKind(node, "image");
}
