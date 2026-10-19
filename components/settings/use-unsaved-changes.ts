"use client";

import { useCallback, useReducer } from "react";
import {
  INITIAL_UNSAVED_CHANGES,
  selectCloseConfirmKey,
  selectHasUnsavedChanges,
  unsavedChangesReducer,
} from "@/lib/shared/settings-unsaved";
import type { SettingsSectionId } from "./registry";

/**
 * The section ids whose pages stage edits and can be dirty.
 *
 * This is the type-level list of "which pages may have unsaved changes": a
 * page that reports a key outside it fails `tsc --noEmit`, so adding a staged
 * page means declaring it here instead of silently dropping its dirty flag.
 * Everything else (`DirtyReporter`, the modal's mark/mark-saved calls, the
 * confirm keys) is narrowed to this union.
 */
export type StagedSettingsKey = Extract<
  SettingsSectionId,
  "profile" | "append-system" | "network-proxy"
>;

/**
 * Thin hook over the pure unsaved-changes reducer.
 *
 * The settings modal owns a single registry of staged keys and asks it two
 * questions — whether to confirm before closing, and whether it may page to
 * another section (see `selectSectionLeave`). Sections report their own
 * dirty-ness with `markDirty` / `markSaved`; nothing else decides the prompt.
 */
export function useUnsavedChanges() {
  const [state, dispatch] = useReducer(
    unsavedChangesReducer<SettingsSectionId>,
    INITIAL_UNSAVED_CHANGES,
  );

  // The setters accept any section id: sections can only *report* through
  // `DirtyReporter`, which is narrowed to `StagedSettingsKey`, so nothing
  // outside that union ever enters the registry.
  const markDirty = useCallback(
    (key: SettingsSectionId) => dispatch({ type: "dirty", key }),
    [],
  );
  const markSaved = useCallback(
    (key: SettingsSectionId) => dispatch({ type: "saved", key }),
    [],
  );
  const discard = useCallback(() => dispatch({ type: "discard" }), []);
  const reload = useCallback((keys: readonly SettingsSectionId[] = []) =>
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
export type DirtyReporter = (key: StagedSettingsKey, dirty: boolean) => void;
