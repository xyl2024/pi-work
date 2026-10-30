"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SessionUiPublish } from "@/lib/shared/session-runtime-state";
import type { AgentControls } from "@/lib/client/commands";
import { isContentEqual } from "@/lib/client/shallowEqual";

export type { ContextUsage, SessionStats } from "@/lib/shared/session-runtime-state";
export type SessionUiState = SessionUiPublish;

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

let leafChangeHandlerRef: ((leafId: string | null) => void) | null = null;

let leafChangeOwner: string | null = null;

export function setLeafChangeHandler(
  fn: ((leafId: string | null) => void) | null,
  ownerId?: string,
) {
  if (fn === null && ownerId && leafChangeOwner !== ownerId) return;
  leafChangeHandlerRef = fn;
  leafChangeOwner = fn === null ? null : ownerId ?? null;
}

export function useSessionLeafChange(): (leafId: string | null) => void {
  return useCallback((leafId: string | null) => {
    leafChangeHandlerRef?.(leafId);
  }, []);
}

let agentControlsRef: AgentControls | null = null;
let agentControlsOwner: string | null = null;
const agentControlsListeners = new Set<() => void>();

export function setAgentControls(c: AgentControls | null, ownerId?: string) {
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
