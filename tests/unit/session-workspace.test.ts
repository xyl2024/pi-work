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
