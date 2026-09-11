import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/lib/shared/types";
import {
  createSessionWorkspaceState,
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
    // "a" tab is active after a user-driven open; switch to the draft tab.
    const draftId = state.tabOrder[0];
    state = sessionWorkspaceReducer(state, { type: "activate", tabId: draftId });
    expect(state.activeTabId).toBe(draftId);

    // Background info sync (e.g. agent finished in a background tab) must not
    // yank the user back to the "a" tab.
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
