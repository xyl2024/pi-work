"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "@/lib/shared/permission-mode";

type State = ReadonlyMap<string, PermissionMode>;

let state: State = new Map();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

const EMPTY: State = new Map();
function getServerSnapshot(): State {
  return EMPTY;
}

export function setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
  if (!sessionId || state.get(sessionId) === mode) return;
  const next = new Map(state);
  next.set(sessionId, mode);
  state = next;
  emit();
}

export function useSessionPermissionMode(
  sessionId: string | null,
  fallback: PermissionMode = DEFAULT_PERMISSION_MODE,
): PermissionMode {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!sessionId) return DEFAULT_PERMISSION_MODE;
  return snapshot.get(sessionId) ?? fallback;
}
