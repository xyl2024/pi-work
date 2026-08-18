import type { SessionInfo } from "@/lib/types";

/** A session tab is either a persisted session or the single client-only draft. */
export type SessionTabKind = "session" | "draft";
export type SessionTabStatus = "idle" | "running" | "completed" | "error";

export interface SessionTab {
  /** Stable client identity. A draft keeps this id when it upgrades. */
  tabId: string;
  kind: SessionTabKind;
  sessionId: string | null;
  session: SessionInfo | null;
  cwd: string | null;
  /** True when the tab has unsent text, images, or a selected slash command. */
  dirty: boolean;
  status: SessionTabStatus;
  createdAt: number;
}

export interface SessionWorkspaceState {
  /** Tab ids in opening order. */
  tabOrder: string[];
  tabs: Record<string, SessionTab>;
  activeTabId: string | null;
}

export type SessionWorkspaceAction =
  | { type: "ensure_draft"; tabId?: string; cwd?: string | null }
  | { type: "open_session"; session: SessionInfo; tabId?: string }
  | { type: "activate"; tabId: string }
  | { type: "set_draft_cwd"; tabId: string; cwd: string | null }
  | { type: "upgrade_draft"; tabId: string; session: SessionInfo }
  | { type: "update_session"; sessionId: string; patch: Partial<SessionInfo> }
  | { type: "set_dirty"; tabId: string; dirty: boolean }
  | { type: "set_status"; tabId: string; status: SessionTabStatus }
  | { type: "close"; tabId: string }
  | { type: "close_session"; sessionId: string };

function makeDraftId(preferred?: string): string {
  if (preferred) return preferred;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft:${crypto.randomUUID()}`;
  }
  return `draft:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createDraftTab(tabId?: string, cwd: string | null = null): SessionTab {
  return {
    tabId: makeDraftId(tabId),
    kind: "draft",
    sessionId: null,
    session: null,
    cwd,
    dirty: false,
    status: "idle",
    createdAt: Date.now(),
  };
}

export function createSessionTab(session: SessionInfo, tabId = `session:${session.id}`): SessionTab {
  return {
    tabId,
    kind: "session",
    sessionId: session.id,
    session,
    cwd: session.cwd || null,
    dirty: false,
    status: session.running ? "running" : "idle",
    createdAt: Date.now(),
  };
}

export function createSessionWorkspaceState(options: {
  withDraft?: boolean;
  draftId?: string;
  cwd?: string | null;
} = {}): SessionWorkspaceState {
  if (options.withDraft === false) {
    return { tabOrder: [], tabs: {}, activeTabId: null };
  }
  const draft = createDraftTab(options.draftId, options.cwd ?? null);
  return {
    tabOrder: [draft.tabId],
    tabs: { [draft.tabId]: draft },
    activeTabId: draft.tabId,
  };
}

function copyState(state: SessionWorkspaceState): SessionWorkspaceState {
  return { tabOrder: [...state.tabOrder], tabs: { ...state.tabs }, activeTabId: state.activeTabId };
}

function addTab(state: SessionWorkspaceState, tab: SessionTab, activate = true): SessionWorkspaceState {
  const next = copyState(state);
  next.tabOrder.push(tab.tabId);
  next.tabs[tab.tabId] = tab;
  if (activate) next.activeTabId = tab.tabId;
  return next;
}

function findDraft(state: SessionWorkspaceState): SessionTab | undefined {
  return state.tabOrder.map((id) => state.tabs[id]).find((tab) => tab?.kind === "draft");
}

function findSessionTab(state: SessionWorkspaceState, sessionId: string): SessionTab | undefined {
  return state.tabOrder
    .map((id) => state.tabs[id])
    .find((tab) => tab?.kind === "session" && tab.sessionId === sessionId);
}

/**
 * Pure workspace reducer. It deliberately owns no React state and can be
 * exercised independently of the UI. In particular, close selection follows
 * the product rule: right neighbour, then left neighbour, then an existing
 * draft or a new draft when the workspace would otherwise be empty.
 */
export function sessionWorkspaceReducer(
  state: SessionWorkspaceState,
  action: SessionWorkspaceAction,
): SessionWorkspaceState {
  switch (action.type) {
    case "ensure_draft": {
      const existing = findDraft(state);
      if (existing) {
        const next = copyState(state);
        if (action.cwd !== undefined && action.cwd !== existing.cwd) {
          next.tabs[existing.tabId] = { ...existing, cwd: action.cwd };
        }
        next.activeTabId = existing.tabId;
        return next;
      }
      return addTab(state, createDraftTab(action.tabId, action.cwd ?? null));
    }

    case "open_session": {
      const existing = findSessionTab(state, action.session.id);
      if (existing) {
        const next = copyState(state);
        next.tabs[existing.tabId] = {
          ...existing,
          session: {
            ...action.session,
            running: action.session.running || existing.status === "running",
          },
          cwd: action.session.cwd || existing.cwd,
          status: action.session.running && existing.status === "idle" ? "running" : existing.status,
        };
        next.activeTabId = existing.tabId;
        return next;
      }
      return addTab(state, createSessionTab(action.session, action.tabId ?? `session:${action.session.id}`));
    }

    case "activate": {
      if (!state.tabs[action.tabId]) return state;
      if (state.activeTabId === action.tabId) return state;
      return { ...state, activeTabId: action.tabId };
    }

    case "set_draft_cwd": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.kind !== "draft" || tab.cwd === action.cwd) return state;
      const next = copyState(state);
      next.tabs[action.tabId] = { ...tab, cwd: action.cwd };
      return next;
    }

    case "upgrade_draft": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.kind !== "draft") return state;
      const duplicate = findSessionTab(state, action.session.id);
      if (duplicate && duplicate.tabId !== action.tabId) {
        // This is defensive (a new server id should be unique), but prevents
        // a duplicate formal tab if two responses race in the client.
        const next = sessionWorkspaceReducer(state, { type: "close", tabId: action.tabId });
        return { ...next, activeTabId: duplicate.tabId };
      }
      const next = copyState(state);
      next.tabs[action.tabId] = {
        ...tab,
        kind: "session",
        sessionId: action.session.id,
        session: action.session,
        cwd: action.session.cwd || tab.cwd,
        status: "running",
      };
      return next;
    }

    case "update_session": {
      const tab = findSessionTab(state, action.sessionId);
      if (!tab || !tab.session) return state;
      const next = copyState(state);
      const session = { ...tab.session, ...action.patch };
      next.tabs[tab.tabId] = { ...tab, session, cwd: session.cwd || tab.cwd };
      return next;
    }

    case "set_dirty": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.dirty === action.dirty) return state;
      const next = copyState(state);
      next.tabs[action.tabId] = { ...tab, dirty: action.dirty };
      return next;
    }

    case "set_status": {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.status === action.status) return state;
      const next = copyState(state);
      next.tabs[action.tabId] = {
        ...tab,
        status: action.status,
        session: tab.session && action.status === "running"
          ? { ...tab.session, running: true }
          : tab.session && action.status !== "running"
            ? { ...tab.session, running: false }
            : tab.session,
      };
      return next;
    }

    case "close_session": {
      let next = state;
      for (const tabId of state.tabOrder) {
        if (next.tabs[tabId]?.sessionId === action.sessionId) {
          next = sessionWorkspaceReducer(next, { type: "close", tabId });
        }
      }
      return next;
    }

    case "close": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      const index = state.tabOrder.indexOf(action.tabId);
      const wasActive = state.activeTabId === action.tabId;
      const next = copyState(state);
      next.tabOrder = state.tabOrder.filter((id) => id !== action.tabId);
      delete next.tabs[action.tabId];

      if (!wasActive) {
        // Keep the current active tab untouched when closing a background tab.
        return next;
      }

      const rightId = state.tabOrder[index + 1];
      const leftId = state.tabOrder[index - 1];
      const preferred = rightId && rightId !== action.tabId ? rightId : leftId;
      if (preferred && next.tabs[preferred]) {
        next.activeTabId = preferred;
        return next;
      }

      const remainingDraft = findDraft(next);
      if (remainingDraft) {
        next.activeTabId = remainingDraft.tabId;
        return next;
      }

      // A workspace should never strand the user on an empty page. Reuse the
      // closed session's cwd for the replacement draft when possible.
      const draft = createDraftTab(undefined, tab.cwd);
      next.tabOrder.push(draft.tabId);
      next.tabs[draft.tabId] = draft;
      next.activeTabId = draft.tabId;
      return next;
    }
  }
}

export function getActiveSessionTab(state: SessionWorkspaceState): SessionTab | null {
  return state.activeTabId ? state.tabs[state.activeTabId] ?? null : null;
}

export function getDraftTab(state: SessionWorkspaceState): SessionTab | null {
  return findDraft(state) ?? null;
}

export function getSessionTab(state: SessionWorkspaceState, sessionId: string): SessionTab | null {
  return findSessionTab(state, sessionId) ?? null;
}

/** Sidebar and session-tab title rule kept in one place. */
export function getSessionTabTitle(session: SessionInfo): string {
  return session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
}
