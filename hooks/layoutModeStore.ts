"use client";

// Layout mode — toggles which column holds the chat card vs. the file /
// right-panel card. Two states:
//
//   - "agentic" (default): center column = chat card + terminal,
//                          right column = file / panel card.
//   - "classic":           center column = file / panel card + terminal,
//                          right column = chat card.
//
// Terminal panel stays in the center column in both modes (it's anchored
// to the column whose identity is "the work area", not the chat region).
//
// The choice is persisted to localStorage and exposed via useSyncExternalStore,
// matching the useTheme pattern (cheap subscription, no React context
// re-render storm).

import { useCallback, useSyncExternalStore } from "react";

export type LayoutMode = "agentic" | "classic";

export const LAYOUT_MODES: LayoutMode[] = ["agentic", "classic"];

export const LAYOUT_MODE_LABELS: Record<LayoutMode, string> = {
  agentic: "Agentic",
  classic: "Classic",
};

const STORAGE_KEY = "pi-work.layoutMode";
const DEFAULT_MODE: LayoutMode = "agentic";

let state: LayoutMode = DEFAULT_MODE;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function readPersisted(): LayoutMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "agentic" || raw === "classic") return raw;
  } catch {
    // ignore (private mode / quota)
  }
  return DEFAULT_MODE;
}

function persist(next: LayoutMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): LayoutMode {
  if (!hydrated && typeof window !== "undefined") {
    state = readPersisted();
    hydrated = true;
  }
  return state;
}

function getServerSnapshot(): LayoutMode {
  return DEFAULT_MODE;
}

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Synchronous read of the persisted layout mode. Intended for
 * useState lazy initializers that need to decide their initial value
 * before the first render commits — reading through useSyncExternalStore
 * there would either be too late (post-render flicker) or run before
 * the store has hydrated from localStorage. Falls back to the default
 * outside the browser.
 */
export function getLayoutModeSync(): LayoutMode {
  return readPersisted();
}

export function useSetLayoutMode(): (next: LayoutMode) => void {
  return useCallback((next: LayoutMode) => {
    if (state === next) return;
    state = next;
    persist(next);
    emit();
  }, []);
}

export function useLayoutModeControls() {
  const mode = useLayoutMode();
  const setMode = useSetLayoutMode();
  return { mode, setMode };
}
