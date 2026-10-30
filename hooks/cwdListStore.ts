"use client";

import { useSyncExternalStore } from "react";
import type { WorkspacesResponse } from "@/lib/shared/types";

interface CwdListState {
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

export function initCwdList() {
  if (fetching || fetched) return;
  fetching = true;
  fetch("/api/workspaces?limit=all")
    .then((r) => r.json() as Promise<WorkspacesResponse>)
    .then((ws) => {
      state = { cwds: ws.workspaces.map((w) => w.cwd) };
      fetched = true;
    })
    .catch(() => {
    })
    .finally(() => {
      fetching = false;
      emit();
    });
}
