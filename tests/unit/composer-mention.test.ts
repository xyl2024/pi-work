import { describe, expect, it } from "vitest";
import {
  applyMentionDirectorySelection,
  applyMentionFileSelection,
  filterMentionEntries,
  mentionDirectoryText,
  mentionParentSelection,
  mentionRelativeDirectory,
  mentionTokenEnd,
  parentMentionEntry,
  type MentionEntry,
} from "@/lib/client/composer/mention";
import {
  emptyComposerState,
  insertNode,
  insertText,
  moveToOffset,
  offsetOfCursor,
} from "@/lib/client/composer/model";
import { reduceComposerKey } from "@/lib/client/composer/reducer";
import { serializeComposer } from "@/lib/client/composer/serialize";
import type { ComposerNode, ComposerState } from "@/lib/client/composer/types";

const cwd = "/repo";

const entries: MentionEntry[] = [
  { name: "src", fullPath: "/repo/src", isDir: true },
  { name: "a.ts", fullPath: "/repo/a.ts", isDir: false },
  { name: "index.ts", fullPath: "/repo/src/index.ts", isDir: false },
];

const srcDir = entries[0];

function typed(value: string, cursor = value.length): ComposerState {
  return moveToOffset(insertText(emptyComposerState(), value), cursor);
}

describe("mention token range", () => {
  it("ends the token where the next whitespace starts", () => {
    expect(mentionTokenEnd("look @src/comp next", 14)).toBe(14);
  });

  it("extends from a cursor in the middle of the token", () => {
    expect(mentionTokenEnd("look @src/comp next", 10)).toBe(14);
  });

  it("covers the rest of a token with no trailing whitespace", () => {
    expect(mentionTokenEnd("@a.ts", 2)).toBe(5);
  });
});

describe("mention directory helpers", () => {
  it("resolves the cwd to an empty relative directory", () => {
    expect(mentionRelativeDirectory("/repo", "/repo")).toBe("");
    expect(mentionRelativeDirectory("/repo/", "/repo")).toBe("");
  });

  it("resolves nested directories relative to the cwd", () => {
    expect(mentionRelativeDirectory("/repo", "/repo/src")).toBe("src");
    expect(mentionRelativeDirectory("/repo", "/repo/src/components")).toBe("src/components");
  });

  it("builds directory text from the current directory and the entry", () => {
    expect(mentionDirectoryText("", srcDir)).toBe("@src/");
    expect(mentionDirectoryText("src", { ...srcDir, name: "components" })).toBe("@src/components/");
  });

  it("navigates to the parent directory", () => {
    expect(mentionDirectoryText("src", { ...srcDir, name: "..", isParent: true })).toBe("@");
    expect(mentionDirectoryText("src/components", { ...srcDir, name: "..", isParent: true })).toBe("@src/");
  });

  it("only offers a parent outside the cwd root", () => {
    expect(parentMentionEntry("")).toBeNull();
    expect(parentMentionEntry("src")?.name).toBe("..");
    expect(parentMentionEntry("src/components")?.fullPath).toBe("src");
  });
});

describe("filterMentionEntries", () => {
  it("keeps everything for an empty query", () => {
    expect(filterMentionEntries(entries, "", cwd)).toEqual(entries);
  });

  it("matches entry names case-insensitively", () => {
    expect(filterMentionEntries(entries, "INDEX", cwd).map((entry) => entry.name)).toEqual(["index.ts"]);
  });

  it("matches the relative path, not just the name", () => {
    expect(filterMentionEntries(entries, "src/", cwd).map((entry) => entry.name)).toEqual(["index.ts"]);
  });
});

describe("directory selection", () => {
  it("replaces the typed token with plain directory text", () => {
    const next = applyMentionDirectorySelection(typed("go @sr"), "", srcDir, 6);
    expect(next.doc.nodes).toEqual([{ kind: "text", text: "go @src/" }]);
    expect(offsetOfCursor(next)).toBe(8);
  });

  it("keeps the text that follows the token", () => {
    const next = applyMentionDirectorySelection(typed("go @sr now", 6), "", srcDir, 6);
    expect(next.doc.nodes).toEqual([{ kind: "text", text: "go @src/ now" }]);
  });

  it("navigates to the parent with Backspace on an empty query", () => {
    const state = typed("go @src/", 8);
    const next = mentionParentSelection(state, "src", offsetOfCursor(state));
    expect(next?.doc.nodes).toEqual([{ kind: "text", text: "go @" }]);
    expect(next && offsetOfCursor(next)).toBe(4);
  });

  it("does not navigate above the cwd root", () => {
    const state = typed("go @");
    expect(mentionParentSelection(state, "", offsetOfCursor(state))).toBeNull();
  });
});

describe("file selection", () => {
  it("replaces the token with a file chip at its offset and leaves the caret after it", () => {
    const next = applyMentionFileSelection(typed("look @a", 7), "a.ts", 7);
    expect(next.doc.nodes).toEqual([
      { kind: "text", text: "look " },
      { kind: "file", relativePath: "a.ts" },
      { kind: "text", text: " " },
    ]);
    expect(offsetOfCursor(next)).toBe(7);
    expect(serializeComposer(next.doc).text).toBe("look `./a.ts` ");
  });

  it("does not add a second space when whitespace already follows", () => {
    const next = applyMentionFileSelection(typed("look @a next", 7), "a.ts", 7);
    expect(next.doc.nodes).toEqual([
      { kind: "text", text: "look " },
      { kind: "file", relativePath: "a.ts" },
      { kind: "text", text: " next" },
    ]);
    expect(offsetOfCursor(next)).toBe(6);
    expect(serializeComposer(next.doc).text).toBe("look `./a.ts` next");
  });

  it("replaces only the token when the cursor sits inside it", () => {
    const next = applyMentionFileSelection(typed("@index.ts", 3), "index.ts", 3);
    expect(next.doc.nodes).toEqual([
      { kind: "file", relativePath: "index.ts" },
      { kind: "text", text: " " },
    ]);
  });

  it("serializes several file chips and mixed text in visual order", () => {
    let state = insertText(emptyComposerState(), "read ");
    state = insertNode(state, { kind: "file", relativePath: "src/a.ts" });
    state = insertText(state, " and ");
    state = insertNode(state, { kind: "file", relativePath: "src/index.ts" });
    state = insertText(state, " now");
    expect(serializeComposer(state.doc).text)
      .toBe("read `./src/a.ts` and `./src/index.ts` now");
  });

  it("serializes adjacent file chips with exactly one space between them", () => {
    const state = insertNodesOf([
      { kind: "file", relativePath: "a.ts" },
      { kind: "file", relativePath: "b.ts" },
    ]);
    expect(serializeComposer(state.doc).text).toBe("`./a.ts` `./b.ts` ");
  });

  it("deletes the whole chip on Backspace at its right boundary", () => {
    const state = moveToOffset(withChipAndTail(), 2);
    const next = reduceComposerKey(state, { key: "Backspace" });
    expect(next.state.doc.nodes).toEqual([{ kind: "text", text: "x y" }]);
    expect(offsetOfCursor(next.state)).toBe(1);
  });

  it("deletes the whole chip on Shift+Backspace at its right boundary", () => {
    const state = moveToOffset(withChipAndTail(), 2);
    const next = reduceComposerKey(state, { key: "Backspace", shiftKey: true });
    expect(next.state.doc.nodes).toEqual([{ kind: "text", text: "x y" }]);
  });
});

function insertNodesOf(nodes: ComposerNode[]): ComposerState {
  let state = emptyComposerState();
  for (const node of nodes) {
    state = node.kind === "text" ? insertText(state, node.text) : insertNode(state, node);
  }
  return state;
}

function withChipAndTail(): ComposerState {
  let state = insertText(emptyComposerState(), "x");
  state = insertNode(state, { kind: "file", relativePath: "a.ts" });
  return insertText(state, " y");
}
