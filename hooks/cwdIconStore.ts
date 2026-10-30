"use client";

import { useSyncExternalStore } from "react";
import { isCwdIconValue } from "@/lib/shared/cwd-icon";

interface CwdIconState {
  map: Record<string, string> | null;
}

const INITIAL: CwdIconState = { map: null };

let state: CwdIconState = INITIAL;
const listeners = new Set<() => void>();
let fetching = false;
let fetched = false;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): CwdIconState {
  return state;
}

function getServerSnapshot(): CwdIconState {
  return INITIAL;
}

export function useCwdIcons(): CwdIconState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCwdIcon(cwd: string | null): string | undefined {
  const { map } = useCwdIcons();
  if (!cwd) return undefined;
  return map?.[cwd];
}

export function initCwdIcons() {
  if (fetching || fetched) return;
  fetching = true;
  fetch("/api/cwd-icons")
    .then((r) => r.json() as Promise<Record<string, string>>)
    .then((map) => {
      state = { map };
      fetched = true;
    })
    .catch(() => {
    })
    .finally(() => {
      fetching = false;
      emit();
    });
}

export async function setCwdIcon(cwd: string, icon: string | null): Promise<boolean> {
  const prev = state.map;
  const next: Record<string, string> = { ...(prev ?? {}) };
  if (icon) {
    if (!isCwdIconValue(icon)) return false;
    next[cwd] = icon;
  } else {
    delete next[cwd];
  }
  state = { map: next };
  fetched = true;
  emit();

  try {
    const res = await fetch("/api/cwd-icons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, icon }),
    });
    if (!res.ok) throw new Error("failed to persist cwd icon");
    return true;
  } catch {
    state = { map: prev };
    emit();
    return false;
  }
}