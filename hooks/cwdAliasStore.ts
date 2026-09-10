"use client";

import { useSyncExternalStore } from "react";

/**
 * App-wide cwd alias map, following the same module-scoped
 * `useSyncExternalStore` pattern as cwdIconStore. The map (absolute cwd
 * path → user-set display alias) is fetched once per page load and
 * updated optimistically on save.
 */

interface CwdAliasState {
  map: Record<string, string> | null;
}

const INITIAL: CwdAliasState = { map: null };

let state: CwdAliasState = INITIAL;
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

function getSnapshot(): CwdAliasState {
  return state;
}

function getServerSnapshot(): CwdAliasState {
  return INITIAL;
}

export function useCwdAliases(): CwdAliasState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Alias for one cwd, or undefined when unset / not fetched yet. */
export function useCwdAlias(cwd: string | null): string | undefined {
  const { map } = useCwdAliases();
  if (!cwd) return undefined;
  return map?.[cwd];
}

/** Fetch the cwd→alias map once per page load. Idempotent. */
export function initCwdAliases() {
  if (fetching || fetched) return;
  fetching = true;
  fetch("/api/cwd-aliases")
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
 * Set (or clear, when alias is null/empty) the alias for one cwd.
 * Optimistic: updates local state immediately, then persists via
 * POST /api/cwd-aliases. Returns true on success, false on failure
 * (local change is reverted).
 */
export async function setCwdAlias(cwd: string, alias: string | null): Promise<boolean> {
  const prev = state.map;
  const next: Record<string, string> = { ...(prev ?? {}) };
  const trimmed = alias?.trim() ?? "";
  if (trimmed.length > 0) {
    next[cwd] = trimmed;
  } else {
    delete next[cwd];
  }
  state = { map: next };
  fetched = true;
  emit();

  try {
    const res = await fetch("/api/cwd-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, alias: trimmed.length > 0 ? trimmed : null }),
    });
    if (!res.ok) throw new Error("failed to persist cwd alias");
    return true;
  } catch {
    // revert on failure
    state = { map: prev };
    emit();
    return false;
  }
}
