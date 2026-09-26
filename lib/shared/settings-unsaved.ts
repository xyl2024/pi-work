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

/** A staged setting key (e.g. "append-system", "network-proxy", "profile"). */
export type SettingsKey = string;

export interface UnsavedChangesState {
  /** Dirty keys, unique, in first-dirtied order. */
  readonly dirty: readonly SettingsKey[];
}

/** The i18n key for the close-confirm prompt. */
export const UNSAVED_CHANGES_CONFIRM_KEY = "Discard unsaved changes?";

export type UnsavedChangesAction =
  /** A staged value changed away from its saved baseline. */
  | { type: "dirty"; key: SettingsKey }
  /** A staged value was written to disk (or reverted to its baseline). */
  | { type: "saved"; key: SettingsKey }
  /** Throw away everything. */
  | { type: "discard" }
  /** Re-read disk: reset the baseline to exactly these keys. */
  | { type: "reload"; keys?: readonly SettingsKey[] };

export const INITIAL_UNSAVED_CHANGES: UnsavedChangesState = { dirty: [] };

export function unsavedChangesReducer(
  state: UnsavedChangesState,
  action: UnsavedChangesAction,
): UnsavedChangesState {
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

/** Whether anything is still unsaved. */
export function selectHasUnsavedChanges(state: UnsavedChangesState): boolean {
  return state.dirty.length > 0;
}

/**
 * The close-confirm prompt's i18n key, or null when it is safe to close
 * without asking.
 */
export function selectCloseConfirmKey(state: UnsavedChangesState): string | null {
  return state.dirty.length > 0 ? UNSAVED_CHANGES_CONFIRM_KEY : null;
}