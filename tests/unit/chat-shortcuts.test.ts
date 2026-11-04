import { describe, expect, it } from "vitest";
import {
  canFocusChatInput,
  canToggleSessionSearch,
  type ChatShortcutFacts,
} from "@/lib/shared/chat-shortcuts";

const chatInForeground: ChatShortcutFacts = {
  foreground: true,
  tabActive: true,
  sessionId: "session-1",
};

describe("session shortcuts follow the chat card foreground", () => {
  it("opens session search when the chat card is active and in front", () => {
    expect(canToggleSessionSearch(chatInForeground)).toBe(true);
  });

  it("keeps session search shut while a main view covers the chat card", () => {
    expect(canToggleSessionSearch({ ...chatInForeground, foreground: false })).toBe(false);
  });

  it("keeps session search shut for a background tab even in front", () => {
    expect(canToggleSessionSearch({ ...chatInForeground, tabActive: false })).toBe(false);
  });

  it("keeps session search shut before a session exists", () => {
    expect(canToggleSessionSearch({ ...chatInForeground, sessionId: null })).toBe(false);
  });

  it("focuses the chat input only while the chat card is in front", () => {
    expect(canFocusChatInput(chatInForeground)).toBe(true);
    expect(canFocusChatInput({ ...chatInForeground, foreground: false })).toBe(false);
  });

  it("restores both shortcuts as soon as the chat card returns to the front", () => {
    const hidden: ChatShortcutFacts = { ...chatInForeground, foreground: false };
    expect(canToggleSessionSearch(hidden)).toBe(false);
    expect(canFocusChatInput(hidden)).toBe(false);
    expect(canToggleSessionSearch({ ...hidden, foreground: true })).toBe(true);
    expect(canFocusChatInput({ ...hidden, foreground: true })).toBe(true);
  });
});
