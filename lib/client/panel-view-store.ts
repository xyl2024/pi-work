"use client";

import { useSyncExternalStore } from "react";
import type { PanelViewKind } from "@/lib/shared/panelTabs";
import { isContentEqual } from "./shallowEqual";

export type PanelViewLoadPolicy = "once" | "on-open" | "on-visible";

export interface PanelViewCloseGuard {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
  discard(): void;
}

export type PanelViewConfirm = (guard: PanelViewCloseGuard) => boolean | Promise<boolean>;

export type PanelViewStatus = string | number | boolean | null;

export interface PanelViewWriter<S, P> {
  get(): S;
  patch(partial: Partial<S>): void;
  openPage(page: P): void;
  resetPages(): void;
}

export interface PanelViewLoadContext<S, P> extends PanelViewWriter<S, P> {
  signal: AbortSignal;
}

export interface PanelViewBackEvent<S, P> {
  pages: readonly P[];
  popped: P | null;
  closePanel: boolean;
  writer: PanelViewWriter<S, P>;
}

export interface PanelViewPagesEvent<S, P> {
  pages: readonly P[];
  writer: PanelViewWriter<S, P>;
}

export interface PanelViewAdapter<S, P, C, K> {
  kind: PanelViewKind;
  initial: S;
  rootPage: P;
  loadPolicy: PanelViewLoadPolicy;
  key(context: C, state: S): K;
  load(key: K, context: PanelViewLoadContext<S, P>): Promise<void> | void;
  start?(context: PanelViewWriter<S, P>): void;
  stop?(context: PanelViewWriter<S, P>): void;
  release(context: PanelViewWriter<S, P>): void;
  afterPages?(event: PanelViewPagesEvent<S, P>): void;
  afterBack?(event: PanelViewBackEvent<S, P>): void;
  guard(state: S): PanelViewCloseGuard | null;
  status(state: S): PanelViewStatus;
  isRootPage?(pages: readonly P[]): boolean;
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
  readonly kind: PanelViewKind;
  get(): S;
  patch(partial: Partial<S>): void;
  scope(): PanelViewWriter<S, P>;
  getSnapshot(): PanelViewSnapshot<S, P>;
  subscribe(listener: () => void): () => void;
  useSnapshot(): PanelViewSnapshot<S, P>;
  useStatus(): PanelViewStatus;
  open(context: C): void;
  setVisible(visible: boolean): void;
  reload(): void;
  pages(): readonly P[];
  currentPage(): P;
  pageDepth(): number;
  openPage(page: P): void;
  resetPages(): void;
  back(): PanelViewBackResult;
  status(): PanelViewStatus;
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
  let loadedKey: { key: K } | null = null;
  let loadingKey: { key: K } | null = null;
  let currentKey: { key: K } | null = null;
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

  function makeWriter(accept: () => boolean): PanelViewWriter<S, P> {
    return {
      get: () => snapshot.view,
      patch: (partial) => {
        if (!accept()) return;
        patch(partial);
      },
      openPage: (page) => {
        if (!accept()) return;
        openPage(page);
      },
      resetPages: () => {
        if (!accept()) return;
        resetPages();
      },
    };
  }

  function scopedWriter(): PanelViewWriter<S, P> {
    const captured = epoch;
    return makeWriter(() => captured === epoch);
  }

  function loadWriter(generation: number, captured: number): PanelViewWriter<S, P> {
    return makeWriter(() => generation === loadGeneration && captured === epoch);
  }

  function isKey(candidate: { key: K } | null, key: K): boolean {
    return candidate !== null && Object.is(candidate.key, key);
  }

  function shouldLoad(key: K, opening: boolean): boolean {
    if (adapter.loadPolicy === "on-visible" && !visible) return false;
    if (opening && adapter.loadPolicy === "on-open") return true;
    if (isKey(loadingKey, key)) return false;
    if (isKey(loadedKey, key)) return false;
    return true;
  }

  function startLoad(key: K): void {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const generation = ++loadGeneration;
    const captured = epoch;
    loadingKey = { key };
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
        loadedKey = { key };
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
    const opening = isKey(currentKey, key);
    currentKey = { key };
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
    if (isKey(loadingKey, currentKey.key)) return;
    startLoad(currentKey.key);
  }

  function reload(): void {
    if (currentKey === null) return;
    startLoad(currentKey.key);
  }

  function currentPage(): P {
    const pages = snapshot.pages;
    return pages.length > 0 ? pages[pages.length - 1] : adapter.rootPage;
  }

  function notifyPages(pages: readonly P[]): void {
    adapter.afterPages?.({ pages, writer: scopedWriter() });
  }

  function openPage(page: P): void {
    const pages = snapshot.pages;
    const next = adapter.isSiblingPage(page, currentPage())
      ? [...pages.slice(0, -1), page]
      : [...pages, page];
    snapshot = { ...snapshot, pages: next };
    emit();
    notifyPages(next);
  }

  function resetPages(): void {
    const next = [adapter.rootPage];
    snapshot = { ...snapshot, pages: next };
    emit();
    notifyPages(next);
  }

  function isRootPage(pages: readonly P[]): boolean {
    return adapter.isRootPage ? adapter.isRootPage(pages) : pages.length <= 1;
  }

  function back(): PanelViewBackResult {
    const pages = snapshot.pages;
    if (isRootPage(pages)) {
      adapter.afterBack?.({ pages, popped: null, closePanel: true, writer: scopedWriter() });
      return { closePanel: true };
    }
    const popped = pages[pages.length - 1];
    const next = pages.slice(0, -1);
    snapshot = { ...snapshot, pages: next };
    emit();
    notifyPages(next);
    adapter.afterBack?.({
      pages: next,
      popped,
      closePanel: false,
      writer: scopedWriter(),
    });
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

  function useStatus(): PanelViewStatus {
    return useSyncExternalStore(
      subscribe,
      () => adapter.status(snapshot.view),
      () => adapter.status(initialSnapshot.view),
    );
  }

  return {
    kind: adapter.kind,
    get: () => snapshot.view,
    patch,
    scope: scopedWriter,
    getSnapshot,
    subscribe,
    useSnapshot,
    useStatus,
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
