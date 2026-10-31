"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";

export type PanelViewLoadPolicy = "once" | "on-open" | "on-visible";

export interface PanelViewCloseGuard {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
  discard(): void;
}

export type PanelViewConfirm = (guard: PanelViewCloseGuard) => boolean | Promise<boolean>;

export interface PanelViewWriter<S> {
  get(): S;
  patch(partial: Partial<S>): void;
}

export interface PanelViewLoadContext<S> extends PanelViewWriter<S> {
  signal: AbortSignal;
}

export interface PanelViewAdapter<S, P, C, K> {
  kind: string;
  initial: S;
  rootPage: P;
  loadPolicy: PanelViewLoadPolicy;
  key(context: C, state: S): K;
  load(key: K, context: PanelViewLoadContext<S>): Promise<void> | void;
  start?(context: PanelViewWriter<S>): void;
  stop?(context: PanelViewWriter<S>): void;
  release(context: PanelViewWriter<S>): void;
  guard(state: S): PanelViewCloseGuard | null;
  status(state: S): unknown;
  isRootPage(pages: readonly P[]): boolean;
  isSiblingPage(next: P, current: P): boolean;
}

export interface PanelViewSnapshot<S, P> {
  view: S;
  pages: readonly P[];
}

export interface PanelViewBackResult {
  closePanel: boolean;
}

export interface PanelViewStore<S, P, C = void> {
  readonly kind: string;
  get(): S;
  patch(partial: Partial<S>): void;
  scope(): PanelViewWriter<S>;
  getSnapshot(): PanelViewSnapshot<S, P>;
  subscribe(listener: () => void): () => void;
  useSnapshot(): PanelViewSnapshot<S, P>;
  open(context: C): void;
  setVisible(visible: boolean): void;
  reload(): void;
  pages(): readonly P[];
  currentPage(): P;
  pageDepth(): number;
  openPage(page: P): void;
  resetPages(): void;
  back(): PanelViewBackResult;
  status(): unknown;
  guard(): PanelViewCloseGuard | null;
  requestClose(confirm: PanelViewConfirm): Promise<boolean>;
  release(): void;
  isReleased(): boolean;
}

export function createPanelViewStore<S, P, C = void, K = string>(
  adapter: PanelViewAdapter<S, P, C, K>,
): PanelViewStore<S, P, C> {
  const initialSnapshot: PanelViewSnapshot<S, P> = {
    view: adapter.initial,
    pages: [adapter.rootPage],
  };
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  let epoch = 0;
  let loadGeneration = 0;
  let loadController: AbortController | null = null;
  let loadedKey: K | null = null;
  let loadingKey: K | null = null;
  let currentKey: K | null = null;
  let visible = true;
  let started = false;
  let closing = false;
  let released = false;
  let reopenContext: { current: C } | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function patch(partial: Partial<S>): void {
    const view = snapshot.view;
    let changed = false;
    for (const key of Object.keys(partial) as (keyof S)[]) {
      if (!isContentEqual(partial[key], view[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, view: { ...view, ...partial } };
    emit();
  }

  function scopedWriter(): PanelViewWriter<S> {
    const captured = epoch;
    return {
      get: () => snapshot.view,
      patch: (partial) => {
        if (captured !== epoch) return;
        patch(partial);
      },
    };
  }

  function loadWriter(generation: number, captured: number): PanelViewWriter<S> {
    return {
      get: () => snapshot.view,
      patch: (partial) => {
        if (generation !== loadGeneration || captured !== epoch) return;
        patch(partial);
      },
    };
  }

  function shouldLoad(key: K, opening: boolean): boolean {
    if (adapter.loadPolicy === "on-visible" && !visible) return false;
    if (opening && adapter.loadPolicy === "on-open") return true;
    if (loadingKey === key) return false;
    if (loadedKey === key) return false;
    return true;
  }

  function startLoad(key: K): void {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const generation = ++loadGeneration;
    const captured = epoch;
    loadingKey = key;
    loadedKey = null;

    const result = adapter.load(key, {
      ...loadWriter(generation, captured),
      signal: controller.signal,
    });

    void Promise.resolve(result)
      .catch(() => {})
      .then(() => {
        if (generation !== loadGeneration || captured !== epoch) return;
        loadingKey = null;
        loadedKey = key;
        loadController = null;
      });
  }

  function cancelLoad(): void {
    loadGeneration += 1;
    loadController?.abort();
    loadController = null;
    loadingKey = null;
    loadedKey = null;
  }

  function open(context: C): void {
    if (closing) {
      reopenContext = { current: context };
      return;
    }
    released = false;
    const key = adapter.key(context, snapshot.view);
    const opening = currentKey === key;
    currentKey = key;
    if (!started) {
      started = true;
      adapter.start?.(scopedWriter());
    }
    if (!opening) cancelLoad();
    if (shouldLoad(key, opening)) startLoad(key);
  }

  function setVisible(next: boolean): void {
    if (visible === next) return;
    visible = next;
    if (!next || currentKey === null) return;
    if (adapter.loadPolicy !== "on-visible") return;
    if (shouldLoad(currentKey, false)) startLoad(currentKey);
  }

  function reload(): void {
    if (currentKey === null) return;
    startLoad(currentKey);
  }

  function currentPage(): P {
    const pages = snapshot.pages;
    return pages.length > 0 ? pages[pages.length - 1] : adapter.rootPage;
  }

  function openPage(page: P): void {
    const pages = snapshot.pages;
    const next = adapter.isSiblingPage(page, currentPage())
      ? [...pages.slice(0, -1), page]
      : [...pages, page];
    snapshot = { ...snapshot, pages: next };
    emit();
  }

  function resetPages(): void {
    snapshot = { ...snapshot, pages: [adapter.rootPage] };
    emit();
  }

  function back(): PanelViewBackResult {
    const pages = snapshot.pages;
    if (adapter.isRootPage(pages)) return { closePanel: true };
    snapshot = { ...snapshot, pages: pages.slice(0, -1) };
    emit();
    return { closePanel: false };
  }

  function guard(): PanelViewCloseGuard | null {
    return adapter.guard(snapshot.view);
  }

  function release(): void {
    if (closing || released) return;
    closing = true;
    const writer = scopedWriter();
    epoch += 1;
    cancelLoad();
    currentKey = null;
    if (started) {
      started = false;
      adapter.stop?.(writer);
    }
    adapter.release(writer);
    snapshot = { view: adapter.initial, pages: [adapter.rootPage] };
    released = true;
    closing = false;
    emit();
    const pending = reopenContext;
    reopenContext = null;
    if (pending) open(pending.current);
  }

  async function requestClose(confirm: PanelViewConfirm): Promise<boolean> {
    if (released) return true;
    const captured = epoch;
    const closeGuard = adapter.guard(snapshot.view);
    if (closeGuard) {
      const confirmed = await confirm(closeGuard);
      if (!confirmed) return false;
      if (captured !== epoch || released) return true;
    }
    closeGuard?.discard();
    release();
    return true;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): PanelViewSnapshot<S, P> {
    return snapshot;
  }

  function getServerSnapshot(): PanelViewSnapshot<S, P> {
    return initialSnapshot;
  }

  function useSnapshot(): PanelViewSnapshot<S, P> {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }

  return {
    kind: adapter.kind,
    get: () => snapshot.view,
    patch,
    scope: scopedWriter,
    getSnapshot,
    subscribe,
    useSnapshot,
    open,
    setVisible,
    reload,
    pages: () => snapshot.pages,
    currentPage,
    pageDepth: () => snapshot.pages.length,
    openPage,
    resetPages,
    back,
    status: () => adapter.status(snapshot.view),
    guard,
    requestClose,
    release,
    isReleased: () => released,
  };
}
