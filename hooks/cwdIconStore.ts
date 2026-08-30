"use client";

import { useSyncExternalStore } from "react";
import { isCwdIconValue } from "@/lib/shared/cwd-icon";

/**
 * App-wide per-cwd custom icon map (absolute cwd path → lucide icon name or
 * `emoji:…`), loaded from ~/.pi-work/config.yaml via GET /api/cwd-icons.
 * Same module-scoped useSyncExternalStore pattern as cwdListStore.
 */

interface CwdIconState {
  /** cwd path → icon name. null = not fetched yet. */
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

/** Icon name for one cwd, or undefined when unset / not fetched yet. */
export function useCwdIcon(cwd: string | null): string | undefined {
  const { map } = useCwdIcons();
  if (!cwd) return undefined;
  return map?.[cwd];
}

/** Fetch the cwd→icon map once per page load. Idempotent. */
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
      // best-effort; `fetched` stays false so a later init call can retry
    })
    .finally(() => {
      fetching = false;
      emit();
    });
}

/**
 * Set (or clear, when icon is null) the custom icon for one cwd. Optimistic:
 * updates local state immediately, then persists via POST /api/cwd-icons.
 * Returns true on success, false on failure (local change is reverted).
 */
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
    // revert on failure
    state = { map: prev };
    emit();
    return false;
  }
}