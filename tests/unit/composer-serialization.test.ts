import { describe, expect, it } from "vitest";
import { serializeComposer } from "@/lib/client/composer/serialize";
import type { ComposerDoc, ComposerNode } from "@/lib/client/composer/types";

function skill(name = "review"): ComposerNode {
  return { kind: "skill", source: "skill", name, command: name };
}

function docOf(...nodes: ComposerNode[]): ComposerDoc {
  return { nodes };
}

describe("serializeComposer", () => {
  it("serializes plain text unchanged", () => {
    expect(serializeComposer(docOf({ kind: "text", text: "hello" })).text).toBe("hello");
  });

  it("serializes a skill without args without a trailing space", () => {
    expect(serializeComposer(docOf(skill(), { kind: "text", text: "" })).text).toBe("/skill:review");
  });

  it("serializes a skill with trimmed args and a single separating space", () => {
    expect(serializeComposer(docOf(skill(), { kind: "text", text: "  fix this  " })).text)
      .toBe("/skill:review fix this");
  });

  it("serializes a file chip as a relative code span with one trailing space", () => {
    expect(serializeComposer(docOf({ kind: "file", relativePath: "src/a.ts" })).text)
      .toBe("`./src/a.ts` ");
  });

  it("does not add a space when the following text already starts with whitespace", () => {
    expect(serializeComposer(docOf({ kind: "file", relativePath: "src/a.ts" }, { kind: "text", text: " next" })).text)
      .toBe("`./src/a.ts` next");
  });

  it("adds a space when the following text starts immediately", () => {
    expect(serializeComposer(docOf({ kind: "file", relativePath: "src/a.ts" }, { kind: "text", text: "next" })).text)
      .toBe("`./src/a.ts` next");
  });

  it("widens the code fence when the path contains backticks", () => {
    expect(serializeComposer(docOf({ kind: "file", relativePath: "a`b.ts" })).text)
      .toBe("``./a`b.ts`` ");
  });

  it("returns image payloads with the nodes, in document order", () => {
    const result = serializeComposer(docOf(
      { kind: "image", id: "one", data: "QUJD", mimeType: "image/png", previewUrl: "blob:one" },
      { kind: "text", text: "x" },
      { kind: "image", id: "two", data: "REVG", mimeType: "image/jpeg", previewUrl: "blob:two" },
    ));
    expect(result.text).toBe("x");
    expect(result.images).toEqual([
      { kind: "image", id: "one", data: "QUJD", mimeType: "image/png", previewUrl: "blob:one" },
      { kind: "image", id: "two", data: "REVG", mimeType: "image/jpeg", previewUrl: "blob:two" },
    ]);
  });

  it("keeps images out of text and returns them in document order", () => {
    const result = serializeComposer(docOf(
      { kind: "text", text: "a" },
      { kind: "image", id: "one", data: "QUJD", mimeType: "image/png", previewUrl: "blob:one" },
      { kind: "text", text: "b" },
      { kind: "image", id: "two", data: "REVG", mimeType: "image/png", previewUrl: "blob:two" },
    ));
    expect(result.text).toBe("ab");
    expect(result.images.map((node) => node.id)).toEqual(["one", "two"]);
  });

  it("keeps the visual order of mixed nodes", () => {
    const result = serializeComposer(docOf(
      { kind: "text", text: "run " },
      skill(),
      { kind: "text", text: " now" },
      { kind: "file", relativePath: "src/x.ts" },
      { kind: "text", text: " done" },
    ));
    expect(result.text).toBe("run /skill:review now`./src/x.ts` done");
  });
});
