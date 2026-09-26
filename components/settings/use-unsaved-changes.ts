"use client";

import { useCallback, useReducer } from "react";
import {
  INITIAL_UNSAVED_CHANGES,
  selectCloseConfirmKey,
  selectHasUnsavedChanges,
  unsavedChangesReducer,
  type SettingsKey,
} from "@/lib/shared/settings-unsaved";

/**
 * Thin hook over the pure unsaved-changes reducer.
 *
 * The settings modal owns a single registry of staged keys and asks it one
 * question — whether to confirm before closing. Sections report their own
 * dirty-ness with `markDirty` / `markSaved`; nothing else decides the prompt.
 */
export function useUnsavedChanges() {
  const [state, dispatch] = useReducer(unsavedChangesReducer, INITIAL_UNSAVED_CHANGES);

  const markDirty = useCallback((key: SettingsKey) => dispatch({ type: "dirty", key }), []);
  const markSaved = useCallback((key: SettingsKey) => dispatch({ type: "saved", key }), []);
  const discard = useCallback(() => dispatch({ type: "discard" }), []);
  const reload = useCallback((keys: readonly SettingsKey[] = []) =>
    dispatch({ type: "reload", keys }), []);

  return {
    dirty: state.dirty,
    hasUnsaved: selectHasUnsavedChanges(state),
    closeConfirmKey: selectCloseConfirmKey(state),
    markDirty,
    markSaved,
    discard,
    reload,
  };
}

export type UnsavedChanges = ReturnType<typeof useUnsavedChanges>;

/** Report a staged setting's dirty-ness from a section. */
export type DirtyReporter = (key: SettingsKey, dirty: boolean) => void;