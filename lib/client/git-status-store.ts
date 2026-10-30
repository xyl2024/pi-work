"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "@/lib/client/shallowEqual";
import type { GitDiffFile, GitFileStatus, GitStatusResponse } from "@/lib/shared/git-diff-types";

export type GitRepoStatusEntry = GitStatusResponse;

export interface GitStatusStoreState {
  entriesByCwd: Map<string, GitRepoStatusEntry>;
  isRepoByCwd: Map<string, boolean>;
  currentCwd: string | null;
}

const EMPTY: GitStatusStoreState = {
  entriesByCwd: new Map(),
  isRepoByCwd: new Map(),
  currentCwd: null,
};

let state: GitStatusStoreState = EMPTY;
const listeners = new Set<() => void>();

const FETCH_TIMEOUT_MS = 10_000;

let fetchAbort: AbortController | null = null;

function emit() {
  for (const l of listeners) l();
}

function patch(p: Partial<GitStatusStoreState>) {
  let changed = false;
  for (const k in p) {
    if (!isContentEqual(p[k as keyof GitStatusStoreState], state[k as keyof GitStatusStoreState])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...p };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): GitStatusStoreState {
  return state;
}

function getServerSnapshot(): GitStatusStoreState {
  return EMPTY;
}

export function useGitStatusStore(): GitStatusStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function startTracking(cwd: string): void {
  if (state.currentCwd === cwd) return;

  if (fetchAbort) {
    fetchAbort.abort();
    fetchAbort = null;
  }

  patch({ currentCwd: cwd });

  void fetchAndStore(cwd);
}

export function stopTracking(): void {
  if (fetchAbort) {
    fetchAbort.abort();
    fetchAbort = null;
  }
  patch({ currentCwd: null });
}

export function notifyMutated(cwd: string, force = false): void {
  if (state.currentCwd !== cwd) return;
  void fetchAndStore(cwd, force);
}

async function fetchAndStore(cwd: string, force = false): Promise<void> {
  if (fetchAbort) {
    fetchAbort.abort();
  }
  fetchAbort = new AbortController();
  const signal = fetchAbort.signal;
  const timeoutId = setTimeout(() => fetchAbort?.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`/api/git?cwd=${encodeURIComponent(cwd)}${force ? "&force=1" : ""}`, { signal });
    if (!res.ok) return;
    const data = (await res.json()) as GitStatusResponse;

    if (state.currentCwd !== cwd) return;

    const nextEntries = new Map(state.entriesByCwd);
    nextEntries.set(cwd, data);

    const nextIsRepo = new Map(state.isRepoByCwd);
    nextIsRepo.set(cwd, data.repoRoot !== null);

    patch({ entriesByCwd: nextEntries, isRepoByCwd: nextIsRepo });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
  } finally {
    clearTimeout(timeoutId);
    if (fetchAbort?.signal === signal) fetchAbort = null;
  }
}

const PRIORITY: Record<GitFileStatus, number> = {
  U: 0,
  M: 1,
  D: 2,
  A: 3,
  R: 4,
  C: 4,
  T: 4,
  "??": 5,
};

function worstStatus(a: GitFileStatus | undefined, b: GitFileStatus): GitFileStatus {
  if (a === undefined) return b;
  return PRIORITY[a] <= PRIORITY[b] ? a : b;
}

export function aggregateFolderStatuses(files: GitDiffFile[]): Map<string, GitFileStatus> {
  const map = new Map<string, GitFileStatus>();
  for (const f of files) {
    let dir = dirnamePosix(f.path);
    while (true) {
      const cur = map.get(dir);
      const next = worstStatus(cur, f.status);
      if (cur === next) {
      }
      map.set(dir, next);
      if (dir === "") break;
      dir = parentDirPosix(dir);
    }
  }
  return map;
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function parentDirPosix(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}