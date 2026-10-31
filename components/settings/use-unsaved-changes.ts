"use client";

import { useCallback, useReducer } from "react";
import {
  INITIAL_UNSAVED_CHANGES,
  selectCloseConfirmKey,
  selectHasUnsavedChanges,
  unsavedChangesReducer,
} from "@/lib/shared/settings-unsaved";
import type { SettingsSectionId } from "./registry";

export type StagedSettingsKey = Extract<
  SettingsSectionId,
  "profile" | "append-system" | "network-proxy" | "deepseek-key" | "dangerous-commands"
>;

export function useUnsavedChanges() {
  const [state, dispatch] = useReducer(
    unsavedChangesReducer<SettingsSectionId>,
    INITIAL_UNSAVED_CHANGES,
  );

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

export type DirtyReporter = (key: StagedSettingsKey, dirty: boolean) => void;
