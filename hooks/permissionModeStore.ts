"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PERMISSION_MODE,
  type SessionPermissionMode,
} from "@/lib/shared/permission-mode";

interface SessionPermissionEntry {
  permissionMode: SessionPermissionMode;
  background: boolean;
}

type State = ReadonlyMap<string, SessionPermissionEntry>;

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

export function setSessionPermissionMode(
  sessionId: string,
  permissionMode: SessionPermissionMode,
  background = false,
): void {
  if (!sessionId) return;
  const existing = state.get(sessionId);
  if (existing?.permissionMode === permissionMode && existing.background === background) return;
  const next = new Map(state);
  next.set(sessionId, { permissionMode, background });
  state = next;
  emit();
}

export function useSessionPermission(
  sessionId: string | null,
  fallbackMode: SessionPermissionMode = DEFAULT_PERMISSION_MODE,
  fallbackBackground = false,
): SessionPermissionEntry {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!sessionId) {
    return { permissionMode: DEFAULT_PERMISSION_MODE, background: false };
  }
  return snapshot.get(sessionId) ?? {
    permissionMode: fallbackMode,
    background: fallbackBackground,
  };
}

export function useSessionPermissionMode(
  sessionId: string | null,
  fallback: SessionPermissionMode = DEFAULT_PERMISSION_MODE,
): SessionPermissionMode {
  return useSessionPermission(sessionId, fallback).permissionMode;
}
