"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SessionUiPublish } from "@/lib/shared/session-runtime-state";
import type { AgentControls } from "@/lib/client/commands";
import { isContentEqual } from "@/lib/client/shallowEqual";

// The store's shape IS the publish projection's payload — declared once in the
// shared layer (`deriveSessionUiPublish`) and aliased here, so a new published
// field has exactly one place to be added. The two types are re-exported for
// the components that imported them from this module before.
export type { ContextUsage, SessionStats } from "@/lib/shared/session-runtime-state";
export type SessionUiState = SessionUiPublish;

/**
 * Session-level UI state that is owned by useAgentSession (in ChatWindow) but
 * rendered by AppShell (in the top bar / branch navigator / context panel).
 *
 * The previous design used 5 separate `onXxxChange` callback props plus a
 * matching `useState` in AppShell for each field, with manual `useRef` +
 * `useEffect` sync machinery in ChatWindow to avoid identity-based re-render
 * loops. That pattern was repeated 5 times (~150 lines) and broke whenever
 * ChatWindow remounted (the cleanup-on-unmount effects wiped the top bar).
 *
 * The store is module-scoped: the active session controller projects its
 * snapshot; AppShell reads via `useSessionUiState()`. Background controllers
 * are deliberately ignored so they cannot overwrite the visible top bar.
 *
 * Functions don't live in the snapshot (they would force infinite re-renders).
 * The branch-leaf-change handler is held in a ref instead, exposed via
 * `useSessionLeafChange()` which returns a stable wrapper.
 */

const INITIAL: SessionUiState = {
  branchTree: [],
  branchActiveLeafId: null,
  systemPrompt: null,
  sessionStats: null,
  contextUsage: null,
  contextComposition: null,
  isStreaming: false,
  agentRunning: false,
  currentModel: null,
  thinkingLevel: "off",
  toolNames: [],
  mainSessionMessages: [],
};

let state: SessionUiState = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Shallow-merge a patch into the store. If no field actually changed, the
 * listeners are NOT notified.
 *
 * For object/array fields, reference equality is too strict — values
 * computed inline (e.g. `sessionStats` is an IIFE inside useAgentSession)
 * are a fresh object on every render even when their contents are identical,
 * which would cause the store to re-publish on every render and AppShell
 * to re-render its 522-session tree dozens of times per second. So we
 * compare object/array values by content instead of by reference.
 */

export function setSessionUiState(patch: Partial<SessionUiState>) {
  let changed = false;
  for (const k in patch) {
    const next = patch[k as keyof SessionUiState];
    const cur = state[k as keyof SessionUiState];
    if (!isContentEqual(next, cur)) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emit();
}

function subscribeSessionUi(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSessionUiSnapshot(): SessionUiState {
  return state;
}

function getSessionUiServerSnapshot(): SessionUiState {
  return INITIAL;
}

export function useSessionUiState(): SessionUiState {
  return useSyncExternalStore(subscribeSessionUi, getSessionUiSnapshot, getSessionUiServerSnapshot);
}

/** Reset the active projection (used only for full workspace teardown). */
export function resetSessionUi() {
  state = INITIAL;
  leafChangeHandlerRef = null;
  leafChangeOwner = null;
  agentControlsRef = null;
  agentControlsOwner = null;
  systemPromptRefreshRef = null;
  systemPromptRefreshOwner = null;
  emit();
}

// ── Branch leaf change handler ────────────────────────────────────────────
// The handler is a useCallback inside useAgentSession, regenerated on each
// render. We can't put it in the snapshot (would cause infinite loops) and
// we can't subscribe to "callback identity" usefully. Stash the latest one
// in a module ref; AppShell's BranchNavigator calls a stable wrapper that
// delegates to the ref.

let leafChangeHandlerRef: ((leafId: string | null) => void) | null = null;

let leafChangeOwner: string | null = null;

export function setLeafChangeHandler(
  fn: ((leafId: string | null) => void) | null,
  ownerId?: string,
) {
  // A stale cleanup from an old active controller must not clear the handler
  // that a newly-active controller just registered.
  if (fn === null && ownerId && leafChangeOwner !== ownerId) return;
  leafChangeHandlerRef = fn;
  leafChangeOwner = fn === null ? null : ownerId ?? null;
}

export function useSessionLeafChange(): (leafId: string | null) => void {
  return useCallback((leafId: string | null) => {
    leafChangeHandlerRef?.(leafId);
  }, []);
}

// ── System-prompt refresh bridge ───────────────────────────────────────
// The active session controller owns the authoritative systemPrompt (it
// resolves it lazily from the runtime state). The BTW panel can get stuck
// showing its "init" disabled state when the controller never published a
// systemPrompt for an already-open session. Rather than have AppShell
// hand-roll its own fetch of the runtime snapshot (which would race the
// controller's write), the active controller registers its
// `refreshSystemPrompt` here and the BTW panel's refresh button invokes it
// through this bridge. Same ownership-guard pattern as `agentControls`.

let systemPromptRefreshRef: (() => void) | null = null;
let systemPromptRefreshOwner: string | null = null;
const systemPromptRefreshListeners = new Set<() => void>();

export function setSystemPromptRefreshHandler(fn: (() => void) | null, ownerId?: string) {
  // A stale cleanup from an old active controller must not clear the
  // handler that a newly-active controller just registered.
  if (fn === null && ownerId && systemPromptRefreshOwner !== ownerId) return;
  systemPromptRefreshRef = fn;
  systemPromptRefreshOwner = fn === null ? null : ownerId ?? null;
  for (const l of systemPromptRefreshListeners) l();
}

/** Stable trigger that AppShell's BTW refresh button calls to re-check
 *  systemPrompt readiness. Inert (no-op) when no active controller has
 *  registered a handler. */
export function useSystemPromptRefresh(): () => void {
  return useCallback(() => {
    systemPromptRefreshRef?.();
  }, []);
}

export function useSystemPromptRefreshAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      systemPromptRefreshListeners.add(cb);
      return () => {
        systemPromptRefreshListeners.delete(cb);
      };
    },
    () => systemPromptRefreshRef !== null,
    () => false,
  );
}

// ── Agent controls (palette bridge) ─────────────────────────────────────
// Imperative handlers owned by useAgentSession inside ChatWindow, exposed
// here so AppShell can wire them into the command palette. ChatWindow
// registers controls while active and clears them only while it still owns
// the bridge. The store notifies subscribers when the reference changes, but
// individual functions inside `controls` are stable across re-renders —
// they are recreated by useCallback in useAgentSession only when their
// own deps change, which the palette doesn't need to track.

let agentControlsRef: AgentControls | null = null;
let agentControlsOwner: string | null = null;
const agentControlsListeners = new Set<() => void>();

export function setAgentControls(c: AgentControls | null, ownerId?: string) {
  // Ignore cleanup from a background/previous controller when another tab has
  // already claimed the active command-palette bridge.
  if (c === null && ownerId && agentControlsOwner !== ownerId) return;
  agentControlsRef = c;
  agentControlsOwner = c === null ? null : ownerId ?? null;
  for (const l of agentControlsListeners) l();
}

export function useAgentControls(): AgentControls | null {
  return useSyncExternalStore(
    (cb) => {
      agentControlsListeners.add(cb);
      return () => {
        agentControlsListeners.delete(cb);
      };
    },
    () => agentControlsRef,
    () => null,
  );
}
