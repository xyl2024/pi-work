"use client";

/**
 * Module store for the RSS panel's view state.
 *
 * Mirrors the sessionUiStore / toolCallStatsStore pattern: a single
 * typed state object, useSyncExternalStore-based subscription, content-equality
 * guarded patcher. Owned by the RSS panel so its current view (feeds / articles
 * / reader), selected feed, and open article survive:
 *
 *   - tab switches inside the right panel (memory)
 *   - full page refresh / browser close (localStorage)
 */

import { useEffect, useSyncExternalStore } from "react";
import { isContentEqual } from "@/lib/client/shallowEqual";

// Keep the view shape in sync with `hooks/useRss.ts`. Duplicated here to avoid
// a circular import (useRss imports from rssStore, not the other way around).
export type RssViewKey =
  | { kind: "feeds" }
  | { kind: "articles"; feedId: string }
  | { kind: "reader"; feedId: string; articleId: string };

export interface RssPersistedState {
  view: RssViewKey;
  schemaVersion: 1;
}

const STORAGE_KEY = "pi-rss-view-state";
const SCHEMA_VERSION = 1 as const;

const INITIAL: RssPersistedState = {
  view: { kind: "feeds" },
  schemaVersion: SCHEMA_VERSION,
};

let state: RssPersistedState = INITIAL;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / privacy mode — best effort */
  }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<RssPersistedState> | null;
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return;
    state = {
      ...INITIAL,
      ...parsed,
      view: parsed.view ?? INITIAL.view,
    };
  } catch {
    /* corrupt JSON — leave INITIAL in place */
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): RssPersistedState {
  return state;
}

function getServerSnapshot(): RssPersistedState {
  return INITIAL;
}

export function useRssViewState(): RssPersistedState {
  useEffect(() => {
    hydrate();
    if (!hydrated) return;
    emit();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getRssViewState(): RssPersistedState {
  return state;
}

function patch(next: RssPersistedState) {
  if (isContentEqual(state, next)) return;
  state = next;
  emit();
  persist();
}

// ── Action helpers ───────────────────────────────────────────────────────

export function setRssView(view: RssViewKey) {
  patch({ ...state, view });
}
