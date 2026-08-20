"use client";

import { useMemo, useSyncExternalStore } from "react";
import { isContentEqual } from "@/lib/client/shallowEqual";

/**
 * Session Media Library UI state (会话媒体库).
 *
 * Module-scoped store following the `sessionUiStore` / `toolCallStatsStore`
 * pattern. Owns UI state only; the entry data itself is recomputed from
 * `messages` on every render (see `lib/session-library-derive.ts` and the
 * `useSessionLibraryEntries` hook), so we never duplicate truth.
 *
 * Switching sessions resets the UI state via `resetSessionLibrary()`.
 *
 * UI state fields:
 *
 * - `isOpen` — whether the modal is mounted. The Open button sets this true;
 *   closing it sets it false.
 * - `focusToolCallId` — when the user opens the library from a tool-call
 *   card (e.g. by clicking "N files added" in MessageView), this is the
 *   toolCallId of the originating call. The modal scrolls/highlights the
 *   matching entry once on mount.
 * - `filter` — active type filter: `all` / `image` / `video` / `audio` /
 *   `failed`. (After the `show_file` → `show_media` rename and scope
 *   narrowing, only multimedia types live in the library — no PDF / text
 *   tabs.)
 * - `search` — substring filter against the path basename.
 * - `viewMode` — `grid` (default) / `media-preview` (single media tile in
 *   the modal body — image / video / audio, ←/→ walks the filtered tile
 *   list).
 * - `mediaPreviewTileKey` — composite key `${entryToolCallId}|${path}` of
 *   the tile currently shown in media-preview mode.
 */

export type SessionLibraryFilter =
  | "all"
  | "image"
  | "video"
  | "audio"
  | "failed";

export type SessionLibraryViewMode = "grid" | "media-preview";

export interface SessionLibraryUiState {
  isOpen: boolean;
  focusToolCallId: string | null;
  filter: SessionLibraryFilter;
  search: string;
  viewMode: SessionLibraryViewMode;
  /** Composite tile key (`${entryToolCallId}|${path}`) currently shown in
   *  media-preview mode. ←/→ walks through the visible media tiles. */
  mediaPreviewTileKey: string | null;
}

const INITIAL: SessionLibraryUiState = {
  isOpen: false,
  focusToolCallId: null,
  filter: "all",
  search: "",
  viewMode: "grid",
  mediaPreviewTileKey: null,
};

let state: SessionLibraryUiState = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function patchState(patch: Partial<SessionLibraryUiState>) {
  let changed = false;
  for (const k in patch) {
    const next = patch[k as keyof SessionLibraryUiState];
    const cur = state[k as keyof SessionLibraryUiState];
    if (!isContentEqual(next, cur)) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SessionLibraryUiState {
  return state;
}

function getServerSnapshot(): SessionLibraryUiState {
  return INITIAL;
}

export function useSessionLibraryUi(): SessionLibraryUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── Imperative API ───────────────────────────────────────────────────────

/** Open the modal. Optionally seed `focusToolCallId` so the modal can
 *  scroll/highlight the matching entry on mount. */
export function openSessionLibrary(opts?: { focusToolCallId?: string }): void {
  patchState({
    isOpen: true,
    focusToolCallId: opts?.focusToolCallId ?? null,
  });
}

/** Close the modal and reset view-mode state. Keeps `filter` and `search`
 *  so re-opening lands the user where they left off. */
export function closeSessionLibrary(): void {
  patchState({
    isOpen: false,
    viewMode: "grid",
    mediaPreviewTileKey: null,
    focusToolCallId: null,
  });
}

export function setSessionLibraryFilter(filter: SessionLibraryFilter): void {
  patchState({ filter });
}

export function setSessionLibrarySearch(search: string): void {
  patchState({ search });
}

/** Open media-preview mode for the given tile. Works for image, video,
 *  and audio tiles alike. */
export function focusSessionLibraryMedia(tileKey: string): void {
  patchState({
    viewMode: "media-preview",
    mediaPreviewTileKey: tileKey,
  });
}

/** Return to the grid view (closing any media-preview). */
export function backToSessionLibraryGrid(): void {
  patchState({
    viewMode: "grid",
    mediaPreviewTileKey: null,
  });
}

/** Reset all state. Call on session / cwd / new-session transitions. */
export function resetSessionLibrary(): void {
  state = INITIAL;
  emit();
}

// ── Stable action hooks ──────────────────────────────────────────────────
// The imperative setters are module-level and have no React deps, so the
// returned object is memoized once. Keep it stable: effects that depend on
// `actions` must not re-run on every render (an unstable object here was
// the root cause of an infinite render loop when an effect wrote back to
// the store from both its body and its cleanup).

export function useSessionLibraryActions() {
  return useMemo(
    () => ({
      open: openSessionLibrary,
      close: closeSessionLibrary,
      setFilter: setSessionLibraryFilter,
      setSearch: setSessionLibrarySearch,
      focusMedia: focusSessionLibraryMedia,
      backToGrid: backToSessionLibraryGrid,
      reset: resetSessionLibrary,
    }),
    [],
  );
}