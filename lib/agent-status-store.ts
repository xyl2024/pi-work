"use client";

import { useSyncExternalStore } from "react";

/**
 * Cross-cutting agent signals that are needed outside the chat surface
 * (specifically the sidebar Pi Bot companion).
 *
 * `sessionUiStore` already exposes `isStreaming` / `agentRunning` because
 * AppShell needs them for the branch panel; permission and error signals
 * live in their own components today (`usePendingPermissions`,
 * `useAgentSession.error`) and have no module-level handle. This store is
 * the bridge: tiny, write-only-on-change, so the bot can subscribe to all
 * five coarse agent states (idle / thinking / working / surprised / sad)
 * without the chat surface taking on a new context provider.
 *
 * Mirrors the pattern in `sessionUiStore`: one module-level value,
 * `useSyncExternalStore` subscription, `isContentEqual` not needed here
 * because every field is a primitive (boolean / nullable timestamp).
 */

export interface AgentStatusError {
  message: string;
  /** ms-since-epoch when the error was recorded. */
  at: number;
}

interface AgentStatusState {
  hasPendingPermission: boolean;
  lastError: AgentStatusError | null;
}

const INITIAL: AgentStatusState = {
  hasPendingPermission: false,
  lastError: null,
};

let state: AgentStatusState = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): AgentStatusState {
  return state;
}

function getServerSnapshot(): AgentStatusState {
  return INITIAL;
}

/**
 * Replace the whole snapshot. Only fields that actually changed trigger
 * emit(), so a stream of `setHasPendingPermission(false)` calls when
 * nothing changed is a no-op.
 */
function patch(patch: Partial<AgentStatusState>) {
  let changed = false;
  for (const k in patch) {
    const key = k as keyof AgentStatusState;
    if (patch[key] !== state[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emit();
}

export function setHasPendingPermission(value: boolean): void {
  patch({ hasPendingPermission: value });
}

export function reportAgentError(message: string): void {
  patch({ lastError: { message, at: Date.now() } });
}

export function clearAgentError(): void {
  patch({ lastError: null });
}

/** Reset everything (used on session / cwd switch so the bot doesn't carry
 *  stale error/permission state across unrelated sessions). */
export function resetAgentStatus(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

export function useAgentStatusState(): AgentStatusState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}