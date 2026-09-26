import { describe, expect, it } from "vitest";
import {
  INITIAL_UNSAVED_CHANGES,
  UNSAVED_CHANGES_CONFIRM_KEY,
  selectCloseConfirmKey,
  selectHasUnsavedChanges,
  unsavedChangesReducer,
  type UnsavedChangesAction,
  type UnsavedChangesState,
} from "@/lib/shared/settings-unsaved";

function reduce(state: UnsavedChangesState, ...actions: UnsavedChangesAction[]): UnsavedChangesState {
  return actions.reduce(unsavedChangesReducer, state);
}

describe("unsavedChangesReducer", () => {
  it("marks a key dirty then saved, returning to the clean baseline", () => {
    const dirty = reduce(INITIAL_UNSAVED_CHANGES, { type: "dirty", key: "network-proxy" });
    expect(dirty.dirty).toEqual(["network-proxy"]);
    expect(selectHasUnsavedChanges(dirty)).toBe(true);

    const saved = reduce(dirty, { type: "saved", key: "network-proxy" });
    expect(saved.dirty).toEqual([]);
    expect(selectHasUnsavedChanges(saved)).toBe(false);
  });

  it("does not duplicate a key that goes dirty twice", () => {
    const state = reduce(
      INITIAL_UNSAVED_CHANGES,
      { type: "dirty", key: "profile" },
      { type: "dirty", key: "profile" },
    );
    expect(state.dirty).toEqual(["profile"]);
  });

  it("saving one key leaves another key's dirty flag alone", () => {
    const state = reduce(
      INITIAL_UNSAVED_CHANGES,
      { type: "dirty", key: "append-system" },
      { type: "dirty", key: "profile" },
      { type: "saved", key: "append-system" },
    );
    expect(state.dirty).toEqual(["profile"]);
  });

  it("discard clears everything", () => {
    const state = reduce(
      INITIAL_UNSAVED_CHANGES,
      { type: "dirty", key: "a" },
      { type: "dirty", key: "b" },
      { type: "discard" },
    );
    expect(state.dirty).toEqual([]);
  });

  it("reload resets the baseline to the re-read keys", () => {
    const state = reduce(
      INITIAL_UNSAVED_CHANGES,
      { type: "dirty", key: "a" },
      { type: "dirty", key: "b" },
      { type: "reload" },
    );
    expect(state.dirty).toEqual([]);

    const fromDisk = reduce(INITIAL_UNSAVED_CHANGES, { type: "reload", keys: ["a"] });
    expect(fromDisk.dirty).toEqual(["a"]);
  });
});

describe("selectCloseConfirmKey", () => {
  it("is null while everything is saved", () => {
    expect(selectCloseConfirmKey(INITIAL_UNSAVED_CHANGES)).toBeNull();
  });

  it("returns the one confirm-prompt key as soon as anything is dirty", () => {
    for (const key of ["append-system", "network-proxy", "profile"]) {
      const state = reduce(INITIAL_UNSAVED_CHANGES, { type: "dirty", key });
      expect(selectCloseConfirmKey(state)).toBe(UNSAVED_CHANGES_CONFIRM_KEY);
    }
  });

  it("goes back to null after every dirty key is saved", () => {
    const state = reduce(
      INITIAL_UNSAVED_CHANGES,
      { type: "dirty", key: "a" },
      { type: "dirty", key: "b" },
      { type: "saved", key: "a" },
      { type: "saved", key: "b" },
    );
    expect(selectCloseConfirmKey(state)).toBeNull();
  });
});