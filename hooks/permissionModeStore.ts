"use client";

/**
 * Module-scoped index of every session's permission mode (ADR-0021).
 *
 * The session runtime state already carries the mode of the controller that
 * owns it, and the session list API reports `permissionMode` for the sessions
 * that opted in. Neither can answer the question the *chrome* asks: "which
 * sessions wear the red shield right now?" — the tab bar renders sessions whose
 * controllers may not be mounted, and the sidebar renders rows that were listed
 * from disk.
 *
 * So this store is the one read surface for that cross-session question. It is
 * written from exactly two places, both of which are the same fact:
 *
 *   1. the toggle handler (so an idle session with no SSE subscription still
 *      updates immediately),
 *   2. each controller's runtime state, once that controller has folded in its
 *      REST snapshot — both directions, so a mode changed in another tab lands
 *      too, but never the pre-hydration `confirm`, which is the absence of a
 *      belief and would blink an existing shield off.
 *
 * A session that is absent from the map has nothing fresher to say, and callers
 * pass the value the session list reported as the fallback — that is what makes
 * a shield appear on a row from a cold page load, before any controller has
 * mounted. The map therefore holds *overrides*: a `confirm` entry is the point
 * (it overrules a list row that still says full access), while "absent" simply
 * means "whatever the list said".
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "@/lib/shared/permission-mode";

type State = ReadonlyMap<string, PermissionMode>;

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

/** Record one session's mode. A no-op write keeps the map identity, so
 *  subscribers do not re-render for nothing. */
export function setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
  if (!sessionId || state.get(sessionId) === mode) return;
  const next = new Map(state);
  next.set(sessionId, mode);
  state = next;
  emit();
}

/**
 * One session's mode, `fallback` being what a list row reported on disk. The
 * store wins when it has an entry: it is the fresher of the two after a toggle.
 */
export function useSessionPermissionMode(
  sessionId: string | null,
  fallback: PermissionMode = DEFAULT_PERMISSION_MODE,
): PermissionMode {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!sessionId) return DEFAULT_PERMISSION_MODE;
  return snapshot.get(sessionId) ?? fallback;
}
