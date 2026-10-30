import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/lib/shared/types";
import {
  APP_TITLE,
  createSessionWorkspaceState,
  getDocumentTitleForTab,
  sessionWorkspaceReducer,
  type SessionWorkspaceState,
} from "@/hooks/sessionWorkspaceStore";

function makeSession(id: string): SessionInfo {
  return {
    path: "",
    id,
    cwd: "/tmp",
    name: `Session ${id}`,
    created: "",
    modified: "",
    messageCount: 0,
    firstMessage: "",
    running: false,
  };
}

function openSession(state: SessionWorkspaceState, id: string): SessionWorkspaceState {
  return sessionWorkspaceReducer(state, { type: "open_session", session: makeSession(id) });
}

describe("sessionWorkspaceReducer open_session", () => {
  it("does not steal focus from the active tab when only syncing info", () => {
    let state = createSessionWorkspaceState();
    state = openSession(state, "a");
    const draftId = state.tabOrder[0];
    state = sessionWorkspaceReducer(state, { type: "activate", tabId: draftId });
    expect(state.activeTabId).toBe(draftId);

    const synced = sessionWorkspaceReducer(state, {
      type: "open_session",
      session: { ...makeSession("a"), modified: "later" },
      activate: false,
    });
    expect(synced.activeTabId).toBe(draftId);
    expect(synced.tabs[draftId]).toEqual(state.tabs[draftId]);
  });

  it("still activates the existing tab for user-driven opens", () => {
    let state = createSessionWorkspaceState();
    state = openSession(state, "a");
    const draftId = state.tabOrder[0];
    state = sessionWorkspaceReducer(state, { type: "activate", tabId: draftId });
    const activated = openSession(state, "a");
    expect(activated.activeTabId).not.toBe(draftId);
  });
});

function reorder(state: SessionWorkspaceState, tabId: string, toIndex: number): SessionWorkspaceState {
  return sessionWorkspaceReducer(state, { type: "reorder", tabId, toIndex });
}

function openTwo(state: SessionWorkspaceState, ...ids: string[]): SessionWorkspaceState {
  return ids.reduce(sessionReducerOpen, state);
}

function sessionReducerOpen(current: SessionWorkspaceState, id: string): SessionWorkspaceState {
  return sessionWorkspaceReducer(current, { type: "open_session", session: makeSession(id) });
}

describe("sessionWorkspaceReducer reorder", () => {
  it("moves a tab earlier (forward shift)", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c");
    const result = reorder(state, "session:c", 0);
    expect(result.tabOrder).toEqual(["session:c", "session:a", "session:b"]);
  });

  it("moves a tab later (backward shift)", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c");
    const result = reorder(state, "session:a", 2);
    expect(result.tabOrder).toEqual(["session:b", "session:c", "session:a"]);
  });

  it("moves a tab across several positions to the head and the tail", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c", "d", "e");
    expect(reorder(state, "session:d", 0).tabOrder).toEqual(["session:d", "session:a", "session:b", "session:c", "session:e"]);
    expect(reorder(state, "session:b", 4).tabOrder).toEqual(["session:a", "session:c", "session:d", "session:e", "session:b"]);
  });

  it("clamps an out-of-range toIndex to the ends without corrupting state", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c");
    expect(reorder(state, "session:a", -5).tabOrder).toEqual(["session:a", "session:b", "session:c"]);
    expect(reorder(state, "session:a", 99).tabOrder).toEqual(["session:b", "session:c", "session:a"]);
    expect(Object.keys(reorder(state, "session:a", 99).tabs)).toEqual(["session:a", "session:b", "session:c"]);
  });

  it("is a no-op when the tabId is not in tabOrder", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b");
    expect(reorder(state, "session:missing", 0)).toBe(state);
  });

  it("keeps the active tab active after reordering", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c");
    state = sessionWorkspaceReducer(state, { type: "activate", tabId: "session:b" });
    const result = reorder(state, "session:b", 0);
    expect(result.activeTabId).toBe("session:b");
    expect(result.tabOrder[0]).toBe("session:b");
  });

  it("keeps close-neighbor activation working off the new order after a reorder", () => {
    let state = createSessionWorkspaceState({ withDraft: false });
    state = openTwo(state, "a", "b", "c");
    state = reorder(state, "session:a", 1);
    expect(state.tabOrder).toEqual(["session:b", "session:a", "session:c"]);
    state = sessionWorkspaceReducer(state, { type: "activate", tabId: "session:a" });
    const closed = sessionWorkspaceReducer(state, { type: "close", tabId: "session:a" });
    expect(closed.tabOrder).toEqual(["session:b", "session:c"]);
    expect(closed.activeTabId).toBe("session:c");
  });

  it("treats draft tabs like session tabs", () => {
    const draftId = "draft:x";
    let state = createSessionWorkspaceState({ draftId });
    expect(state.tabOrder).toEqual([draftId]);
    state = openTwo(state, "a", "b");
    const result = reorder(state, draftId, 2);
    expect(result.tabOrder).toEqual(["session:a", "session:b", draftId]);
    const back = reorder(result, draftId, 0);
    expect(back.tabOrder).toEqual([draftId, "session:a", "session:b"]);
  });
});

describe("getDocumentTitleForTab", () => {
  it("shows the active session name with the app-name suffix", () => {
    const state = openSession(createSessionWorkspaceState(), "a");
    const tab = state.tabs[state.activeTabId!];
    expect(getDocumentTitleForTab(tab)).toBe(`Session a · ${APP_TITLE}`);
  });

  it("falls back to the plain app name for a draft or empty workspace", () => {
    const draft = createSessionWorkspaceState();
    expect(getDocumentTitleForTab(draft.tabs[draft.activeTabId!])).toBe(APP_TITLE);
    expect(getDocumentTitleForTab(null)).toBe(APP_TITLE);
  });

  it("follows a renamed session", () => {
    let state = openSession(createSessionWorkspaceState(), "a");
    state = sessionWorkspaceReducer(state, {
      type: "update_session",
      sessionId: "a",
      patch: { name: "Renamed" },
    });
    expect(getDocumentTitleForTab(state.tabs[state.activeTabId!])).toBe(`Renamed · ${APP_TITLE}`);
  });
});
