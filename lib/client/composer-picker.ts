"use client";

import { useSyncExternalStore } from "react";

export type ComposerPickerAction = "image" | "skill" | "file";
export type ComposerPickerView = "main" | "skill" | "file";

export type ComposerPickerItem =
  | { action: "image"; opensView: false }
  | { action: "skill"; opensView: true }
  | { action: "file"; opensView: true };

export const COMPOSER_PICKER_ITEMS: readonly ComposerPickerItem[] = [
  { action: "image", opensView: false },
  { action: "skill", opensView: true },
  { action: "file", opensView: true },
];

export interface ComposerPickerSnapshot {
  open: boolean;
  view: ComposerPickerView;
  activeIndex: number;
}

export interface ComposerPickerActivation {
  action: ComposerPickerAction;
  closed: boolean;
  view: ComposerPickerView;
}

export interface ComposerPickerBackResult {
  closed: boolean;
}

export interface ComposerPicker {
  get(): ComposerPickerSnapshot;
  subscribe(listener: () => void): () => void;
  useSnapshot(): ComposerPickerSnapshot;
  open(): void;
  close(): void;
  toggle(): void;
  reset(): void;
  back(): ComposerPickerBackResult;
  openView(view: Exclude<ComposerPickerView, "main">): void;
  setActiveIndex(index: number, itemCount?: number): void;
  moveActive(delta: number, itemCount: number): void;
  activate(index?: number): ComposerPickerActivation | null;
}

const INITIAL: ComposerPickerSnapshot = { open: false, view: "main", activeIndex: 0 };

function sameSnapshot(a: ComposerPickerSnapshot, b: ComposerPickerSnapshot): boolean {
  return a.open === b.open && a.view === b.view && a.activeIndex === b.activeIndex;
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(index, 0), itemCount - 1);
}

export function createComposerPicker(): ComposerPicker {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();

  function set(next: ComposerPickerSnapshot): void {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function get(): ComposerPickerSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function reset(): void {
    set(INITIAL);
  }

  function open(): void {
    set({ open: true, view: "main", activeIndex: 0 });
  }

  function openView(view: Exclude<ComposerPickerView, "main">): void {
    if (!snapshot.open) return;
    set({ open: true, view, activeIndex: 0 });
  }

  function back(): ComposerPickerBackResult {
    if (!snapshot.open) return { closed: false };
    if (snapshot.view !== "main") {
      set({ open: true, view: "main", activeIndex: 0 });
      return { closed: false };
    }
    reset();
    return { closed: true };
  }

  function activate(index: number = snapshot.activeIndex): ComposerPickerActivation | null {
    if (!snapshot.open || snapshot.view !== "main") return null;
    const item = COMPOSER_PICKER_ITEMS[index];
    if (!item) return null;
    if (item.opensView) {
      openView(item.action);
      return { action: item.action, closed: false, view: snapshot.view };
    }
    reset();
    return { action: item.action, closed: true, view: "main" };
  }

  return {
    get,
    subscribe,
    useSnapshot: () => useSyncExternalStore(subscribe, get, get),
    open,
    close: reset,
    toggle() {
      if (snapshot.open) reset();
      else open();
    },
    reset,
    back,
    openView,
    setActiveIndex(index, itemCount = COMPOSER_PICKER_ITEMS.length) {
      set({ ...snapshot, activeIndex: clampIndex(index, itemCount) });
    },
    moveActive(delta, itemCount) {
      if (!snapshot.open || itemCount <= 0 || delta === 0) return;
      const next = ((snapshot.activeIndex + delta) % itemCount + itemCount) % itemCount;
      set({ ...snapshot, activeIndex: next });
    },
    activate,
  };
}
