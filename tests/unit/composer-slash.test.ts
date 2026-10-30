import { describe, expect, it } from "vitest";
import { emptyComposerState, insertText, moveToOffset, offsetOfCursor } from "@/lib/client/composer/model";
import { reduceComposerKey } from "@/lib/client/composer/reducer";
import { serializeComposer } from "@/lib/client/composer/serialize";
import { applySlashSelection, shouldOpenSlashMenu } from "@/lib/client/composer/slash";
import type { ComposerState } from "@/lib/client/composer/types";
import type { SlashResource } from "@/lib/shared/slash-commands";

const skillResource: SlashResource = {
  source: "skill",
  name: "review",
  command: "review",
  description: "",
  path: "",
};

const actionResource: SlashResource = {
  source: "action",
  name: "New session",
  command: "new",
  description: "",
  path: "",
};

function typed(value: string, cursor = value.length): ComposerState {
  return moveToOffset(insertText(emptyComposerState(), value), cursor);
}

const chip = { kind: "skill", source: "skill", name: "review", command: "review" } as const;

describe("applySlashSelection", () => {
  it("replaces the typed query with a skill chip at its offset", () => {
    const next = applySlashSelection(typed("run /rev"), skillResource, 8);
    expect(next.doc.nodes).toEqual([{ kind: "text", text: "run " }, chip]);
    expect(offsetOfCursor(next)).toBe(5);
  });

  it("keeps text that follows the query", () => {
    const next = applySlashSelection(typed("hello /rev world", 10), skillResource, 10);
    expect(next.doc.nodes).toEqual([
      { kind: "text", text: "hello " },
      chip,
      { kind: "text", text: " world" },
    ]);
    expect(offsetOfCursor(next)).toBe(7);
  });

  it("removes the typed query without inserting a chip for builtin actions", () => {
    const next = applySlashSelection(typed("run /new"), actionResource, 8);
    expect(next.doc.nodes).toEqual([{ kind: "text", text: "run " }]);
    expect(offsetOfCursor(next)).toBe(4);
  });

  it("types arguments right after a skill chip", () => {
    const inserted = applySlashSelection(typed("/rev"), skillResource, 4);
    const withArgs = insertText(inserted, "fix this");
    expect(withArgs.doc.nodes).toEqual([chip, { kind: "text", text: "fix this" }]);
    expect(serializeComposer(withArgs.doc).text).toBe("/skill:review fix this");
  });
});

describe("skill chip deletion", () => {
  const inserted = applySlashSelection(typed("/rev"), skillResource, 4);

  it("deletes the whole chip on Backspace at its right boundary", () => {
    const state = moveToOffset(inserted, 1);
    const next = reduceComposerKey(state, { key: "Backspace" });
    expect(next.state.doc.nodes).toEqual([{ kind: "text", text: "" }]);
    expect(offsetOfCursor(next.state)).toBe(0);
  });

  it("deletes the whole chip on Shift+Backspace at its right boundary", () => {
    const state = moveToOffset(inserted, 1);
    const next = reduceComposerKey(state, { key: "Backspace", shiftKey: true });
    expect(next.state.doc.nodes).toEqual([{ kind: "text", text: "" }]);
  });
});

describe("shouldOpenSlashMenu", () => {
  it("opens on a trailing slash", () => {
    expect(shouldOpenSlashMenu("/", 1, false)).toBe(true);
    expect(shouldOpenSlashMenu("hi /", 4, false)).toBe(true);
  });

  it("stays open while a token remains", () => {
    expect(shouldOpenSlashMenu("/rev", 4, true)).toBe(true);
  });

  it("does not open for a closed menu with only a partial token", () => {
    expect(shouldOpenSlashMenu("/rev", 4, false)).toBe(false);
  });

  it("closes when the token is gone", () => {
    expect(shouldOpenSlashMenu("/rev done", 9, true)).toBe(false);
  });
});
