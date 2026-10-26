import { describe, expect, it } from "vitest";
import type { SettingsSectionId } from "@/components/settings/registry";
import {
  INITIAL_UNSAVED_CHANGES,
  UNSAVED_CHANGES_CONFIRM_KEY,
  selectCloseConfirmKey,
  selectHasUnsavedChanges,
  selectIsDirty,
  selectSectionLeave,
  unsavedChangesReducer,
  type SectionLeaveDecision,
  type UnsavedChangesAction,
  type UnsavedChangesState,
} from "@/lib/shared/settings-unsaved";

function reduce<K extends string>(
  state: UnsavedChangesState<K>,
  ...actions: UnsavedChangesAction<K>[]
): UnsavedChangesState<K> {
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

describe("selectIsDirty", () => {
  it("reports only the keys that are still dirty", () => {
    const state = reduce(INITIAL_UNSAVED_CHANGES, { type: "dirty", key: "profile" });
    expect(selectIsDirty(state, "profile")).toBe(true);
    expect(selectIsDirty(state, "ui-sounds")).toBe(false);
  });
});

describe("selectSectionLeave", () => {
  const dirtyState = (...keys: SettingsSectionId[]) =>
    reduce(INITIAL_UNSAVED_CHANGES, ...keys.map((key) => ({ type: "dirty" as const, key })));

  /** The confirm decision, narrowed, or a failed assertion. */
  function expectConfirm<K extends string>(
    decision: SectionLeaveDecision<K>,
  ): Extract<SectionLeaveDecision<K>, { kind: "confirm" }> {
    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("expected a confirm decision");
    return decision;
  }

  /** Grant the confirm and apply the discard it was asked about. */
  const discardOnLeave = (state: UnsavedChangesState<SettingsSectionId>, from: SettingsSectionId, to: SettingsSectionId) =>
    reduce(state, { type: "saved", key: expectConfirm(selectSectionLeave(state, from, to)).key });

  it("lets the user leave when nothing is dirty", () => {
    expect(selectSectionLeave(INITIAL_UNSAVED_CHANGES, "profile", "ui-sounds")).toEqual({
      kind: "leave",
    });
  });

  it("does not ask about some other page's dirty flag when leaving a clean page", () => {
    const state = dirtyState("network-proxy");
    expect(selectSectionLeave(state, "profile", "ui-sounds")).toEqual({ kind: "leave" });
    expect(selectSectionLeave(state, "profile", "network-proxy")).toEqual({ kind: "leave" });
  });

  it("lets the user re-click the page that is already open, even while it is dirty", () => {
    const state = dirtyState("profile");
    expect(selectSectionLeave(state, "profile", "profile")).toEqual({ kind: "leave" });
  });

  it("asks before leaving a dirty page and names the page that will be dropped", () => {
    const state = dirtyState("append-system");
    expect(selectSectionLeave(state, "append-system", "profile")).toEqual({
      kind: "confirm",
      key: "append-system",
    });
  });

  it("asks only about the page being left when several pages are dirty", () => {
    const state = dirtyState("profile", "network-proxy");
    expect(selectSectionLeave(state, "profile", "ui-sounds")).toEqual({
      kind: "confirm",
      key: "profile",
    });
  });

  it("leaves the other pages' dirty flags alone when the left page is discarded", () => {
    const afterDiscard = discardOnLeave(dirtyState("profile", "network-proxy"), "profile", "ui-sounds");
    expect(afterDiscard.dirty).toEqual(["network-proxy"]);
    expect(selectCloseConfirmKey(afterDiscard)).toBe(UNSAVED_CHANGES_CONFIRM_KEY);
  });

  it("stops asking on close once the left page was discarded", () => {
    const afterDiscard = discardOnLeave(dirtyState("dangerous-commands"), "dangerous-commands", "profile");
    expect(selectCloseConfirmKey(afterDiscard)).toBeNull();
  });
});
