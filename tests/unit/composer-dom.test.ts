// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readDoc, readSelection, writeDoc, writeSelection } from "@/lib/client/composer/dom";
import type { ComposerDoc } from "@/lib/client/composer/types";

const labels = {
  skill: (node: { name: string }) => `Skill ${node.name}`,
  file: (path: string) => `File ${path}`,
  image: (id: string) => `Image ${id}`,
};

const doc: ComposerDoc = {
  nodes: [
    { kind: "text", text: "ab" },
    { kind: "skill", source: "skill", name: "review", command: "review" },
    { kind: "text", text: "cd" },
  ],
};

let container: HTMLDivElement | undefined;
afterEach(() => {
  container?.remove();
  container = undefined;
  window.getSelection()?.removeAllRanges();
});

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("composer DOM projection", () => {
  it("writes and reads text and chips back into the document model", () => {
    const element = mount();
    writeDoc(element, doc, labels);
    expect(element.textContent).toBe("abreviewcd");
    expect(readDoc(element)).toEqual(doc);
  });

  it("marks chips as non-editable with an accessible name", () => {
    const element = mount();
    writeDoc(element, doc, labels);
    const chip = element.querySelector("[data-composer-kind='skill']");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    expect(chip?.getAttribute("aria-label")).toBe("Skill review");
  });

  it("maps a DOM selection to logical offsets and back", () => {
    const element = mount();
    writeDoc(element, doc, labels);
    writeSelection(element, { start: 3, end: 4 });
    expect(readSelection(element)).toEqual({ start: 3, end: 4 });
  });

  it("clamps a selection inside a chip to after it", () => {
    const element = mount();
    writeDoc(element, doc, labels);
    const chip = element.querySelector("[data-composer-kind='skill']") as HTMLElement;
    const text = chip.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(readSelection(element)).toEqual({ start: 3, end: 3 });
  });

  it("reads an empty editor as an empty text document", () => {
    const element = mount();
    writeDoc(element, { nodes: [{ kind: "text", text: "" }] }, labels);
    expect(element.childNodes.length).toBe(0);
    expect(readDoc(element)).toEqual({ nodes: [] });
    writeSelection(element, { start: 0, end: 0 });
    expect(readSelection(element)).toEqual({ start: 0, end: 0 });
  });
});
