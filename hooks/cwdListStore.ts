"use client";

import { useSyncExternalStore } from "react";
import type { WorkspacesResponse } from "@/lib/types";

/**
 * App-wide recent-cwd list, following the same module-scoped
 * `useSyncExternalStore` pattern as sessionUiStore / toolCallStatsStore.
 *
 * The list is fetched exactly once per page load (see `initCwdList`) so the
 * CwdPicker dropdown is populated before it is ever opened and never
 * refetches on open or on ChatWindow remounts. AppShell also reads the first
 * entry to pre-pick the most recently used cwd on first entry.
 */

export const RECENT_CWD_LIMIT = 5;

interface CwdListState {
  /** Recently used cwds, most recent first. null = not fetched yet. */
  cwds: string[] | null;
}

const INITIAL: CwdListState = { cwds: null };

let state: CwdListState = INITIAL;
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

function getSnapshot(): CwdListState {
  return state;
}

function getServerSnapshot(): CwdListState {
  return INITIAL;
}

export function useCwdList(): CwdListState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Fetch the recent cwd list once per page load. Idempotent — safe to call
 * from AppShell on mount and from CwdPicker on mount; only the first call
 * hits the network.
 */
export function initCwdList() {
  if (fetching || fetched) return;
  fetching = true;
  fetch(`/api/workspaces?limit=${RECENT_CWD_LIMIT}`)
    .then((r) => r.json() as Promise<WorkspacesResponse>)
    .then((ws) => {
      state = { cwds: ws.workspaces.map((w) => w.cwd) };
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
