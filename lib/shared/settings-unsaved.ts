/**
 * Unsaved-changes registry.
 *
 * A single pure reducer holds the set of staged setting keys that are still
 * dirty. The settings modal asks it exactly one question — "do we have unsaved
 * changes, and what does the close-confirm prompt say?" — so "should we prompt
 * before closing" is decided in one place instead of once per section.
 *
 * No React / DOM / server dependencies: driven directly from `tests/unit`.
 */

/**
 * A staged setting key (e.g. "append-system", "network-proxy", "profile").
 *
 * The reducer is generic over the key type so the settings modal can key it by
 * its section ids; the "which sections may stage edits" list lives in the
 * `DirtyReporter` type the sections report through, so a section that reports
 * a key outside that union fails type checking.
 */
export type SettingsKey = string;

export interface UnsavedChangesState<K extends string = SettingsKey> {
  /** Dirty keys, unique, in first-dirtied order. */
  readonly dirty: readonly K[];
}

/** The i18n key for the close-confirm prompt. */
export const UNSAVED_CHANGES_CONFIRM_KEY = "Discard unsaved changes?";

export type UnsavedChangesAction<K extends string = SettingsKey> =
  /** A staged value changed away from its saved baseline. */
  | { type: "dirty"; key: K }
  /**
   * A staged value was written to disk, reverted to its baseline, or thrown
   * away on purpose (a confirmed "discard" on page navigation).
   */
  | { type: "saved"; key: K }
  /** Throw away everything. */
  | { type: "discard" }
  /** Re-read disk: reset the baseline to exactly these keys. */
  | { type: "reload"; keys?: readonly K[] };

/** Empty for any key type: `readonly never[]` widens to `readonly K[]`. */
export const INITIAL_UNSAVED_CHANGES: UnsavedChangesState<never> = { dirty: [] };

export function unsavedChangesReducer<K extends string>(
  state: UnsavedChangesState<K>,
  action: UnsavedChangesAction<K>,
): UnsavedChangesState<K> {
  switch (action.type) {
    case "dirty":
      if (state.dirty.includes(action.key)) return state;
      return { dirty: [...state.dirty, action.key] };
    case "saved":
      if (!state.dirty.includes(action.key)) return state;
      return { dirty: state.dirty.filter((key) => key !== action.key) };
    case "discard":
      return state.dirty.length === 0 ? state : { dirty: [] };
    case "reload": {
      const keys = [...new Set(action.keys ?? [])];
      if (keys.length === state.dirty.length && keys.every((k, i) => k === state.dirty[i])) {
        return state;
      }
      return { dirty: keys };
    }
  }
}

/** Whether one specific key is still dirty (drives the sidebar dot). */
export function selectIsDirty<K extends string>(state: UnsavedChangesState<K>, key: K): boolean {
  return state.dirty.some((dirty) => dirty === key);
}

/** Whether anything is still unsaved. */
export function selectHasUnsavedChanges<K extends string>(
  state: UnsavedChangesState<K>,
): boolean {
  return state.dirty.length > 0;
}

/**
 * The close-confirm prompt's i18n key, or null when it is safe to close
 * without asking.
 */
export function selectCloseConfirmKey<K extends string>(
  state: UnsavedChangesState<K>,
): string | null {
  return state.dirty.length > 0 ? UNSAVED_CHANGES_CONFIRM_KEY : null;
}

/** What navigating from one page to another may do. */
export type SectionLeaveDecision<Key extends string> =
  /** Go straight there. */
  | { kind: "leave" }
  /** Ask first; `key` is the staged key that will be dropped if the user agrees. */
  | { kind: "confirm"; key: Key };

/**
 * Whether the modal may switch from `from` to `to` without asking.
 *
 * Paging renders only one page at a time, so a page that staged edits loses
 * its draft when it unmounts; the dirty flag survives in this registry.
 * Asking is tied to the *target* page: opening a page that still has unsaved
 * changes is the moment to confirm dropping them. Re-clicking the page that is
 * already open is not navigation, so it never asks.
 *
 * The key type is the caller's: the settings modal keys its registry by
 * section id, so the returned key can be handed straight back to a `saved`
 * action without narrowing.
 */
export function selectSectionLeave<K extends string>(
  state: UnsavedChangesState<K>,
  from: K,
  to: K,
): SectionLeaveDecision<K> {
  if (from === to) return { kind: "leave" };
  return selectIsDirty(state, to) ? { kind: "confirm", key: to } : { kind: "leave" };
}
