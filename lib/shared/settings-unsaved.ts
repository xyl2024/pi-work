export type SettingsKey = string;

export interface UnsavedChangesState<K extends string = SettingsKey> {
  readonly dirty: readonly K[];
}

export const UNSAVED_CHANGES_CONFIRM_KEY = "Discard unsaved changes?";

export type UnsavedChangesAction<K extends string = SettingsKey> =
  | { type: "dirty"; key: K }
  | { type: "saved"; key: K }
  | { type: "discard" }
  | { type: "reload"; keys?: readonly K[] };

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

export function selectIsDirty<K extends string>(state: UnsavedChangesState<K>, key: K): boolean {
  return state.dirty.some((dirty) => dirty === key);
}

export function selectHasUnsavedChanges<K extends string>(
  state: UnsavedChangesState<K>,
): boolean {
  return state.dirty.length > 0;
}

export function selectCloseConfirmKey<K extends string>(
  state: UnsavedChangesState<K>,
): string | null {
  return state.dirty.length > 0 ? UNSAVED_CHANGES_CONFIRM_KEY : null;
}

export type SectionLeaveDecision<Key extends string> =
  | { kind: "leave" }
  | { kind: "confirm"; key: Key };

export function selectSectionLeave<K extends string>(
  state: UnsavedChangesState<K>,
  from: K,
  to: K,
): SectionLeaveDecision<K> {
  if (from === to) return { kind: "leave" };
  return selectIsDirty(state, from) ? { kind: "confirm", key: from } : { kind: "leave" };
}
