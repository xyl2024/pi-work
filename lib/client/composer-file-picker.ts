"use client";

import { useSyncExternalStore } from "react";
import { formatFilePathReference } from "@/lib/shared/file-reference";

export interface ComposerFileListEntry {
  name: string;
  isDir: boolean;
}

export interface ComposerFileEntry extends ComposerFileListEntry {
  path: string;
  isParent?: boolean;
}

export interface ComposerFilePickerAdapter {
  list(directory: string, options: { signal: AbortSignal }): Promise<readonly ComposerFileListEntry[]>;
}

export interface ComposerFilePickerSnapshot {
  directory: string;
  entries: ComposerFileEntry[];
  selected: string[];
  activeIndex: number;
  page: number;
  loading: boolean;
  error: string | null;
}

export interface ComposerFilePicker {
  get(): ComposerFilePickerSnapshot;
  subscribe(listener: () => void): () => void;
  useSnapshot(): ComposerFilePickerSnapshot;
  load(directory?: string): Promise<boolean>;
  navigate(directory: string): Promise<boolean>;
  retry(): Promise<boolean>;
  reset(): void;
  visibleEntries(): ComposerFileEntry[];
  pageCount(): number;
  setActiveIndex(index: number): void;
  moveActive(delta: number): void;
  nextPage(delta: number): void;
  activate(entry?: ComposerFileEntry): Promise<ComposerFilePickerActivation | null>;
  toggleSelected(entry?: ComposerFileEntry): boolean;
  confirm(): string | null;
}

export type ComposerFilePickerActivation =
  | { kind: "directory"; directory: string }
  | { kind: "insert"; text: string };

export const COMPOSER_FILE_PAGE_SIZE = 8;

const INITIAL: ComposerFilePickerSnapshot = {
  directory: "",
  entries: [],
  selected: [],
  activeIndex: 0,
  page: 0,
  loading: false,
  error: null,
};

function normalizeDirectory(directory: string): string | null {
  const normalized = directory.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

function entryPath(directory: string, name: string): string {
  return [directory, name].filter(Boolean).join("/");
}

function parentDirectory(directory: string): string {
  return directory.split("/").slice(0, -1).join("/");
}

function toEntries(directory: string, listing: readonly ComposerFileListEntry[]): ComposerFileEntry[] {
  const entries = listing.map((entry) => ({ ...entry, path: entryPath(directory, entry.name) }));
  return directory ? [{ name: "..", path: parentDirectory(directory), isDir: true, isParent: true }, ...entries] : entries;
}

function sameSnapshot(a: ComposerFilePickerSnapshot, b: ComposerFilePickerSnapshot): boolean {
  return a.directory === b.directory
    && a.activeIndex === b.activeIndex
    && a.page === b.page
    && a.loading === b.loading
    && a.error === b.error
    && a.entries === b.entries
    && a.selected === b.selected;
}

export function createComposerFilePicker({
  adapter,
  pageSize = COMPOSER_FILE_PAGE_SIZE,
}: {
  adapter: ComposerFilePickerAdapter;
  pageSize?: number;
}): ComposerFilePicker {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();
  const cache = new Map<string, ComposerFileEntry[]>();
  let generation = 0;
  let controller: AbortController | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function get(): ComposerFilePickerSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function set(patch: Partial<ComposerFilePickerSnapshot>): void {
    const next = { ...snapshot, ...patch };
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    emit();
  }

  function reset(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    cache.clear();
    set({ ...INITIAL });
  }

  function pageCount(): number {
    return Math.max(1, Math.ceil(snapshot.entries.length / pageSize));
  }

  function visibleEntries(): ComposerFileEntry[] {
    const start = Math.min(snapshot.page, pageCount() - 1) * pageSize;
    return snapshot.entries.slice(start, start + pageSize);
  }

  async function load(directory = snapshot.directory): Promise<boolean> {
    const normalized = normalizeDirectory(directory);
    if (normalized === null) return false;

    const cached = cache.get(normalized);
    if (cached) {
      generation += 1;
      controller?.abort();
      controller = null;
      set({ directory: normalized, entries: cached, activeIndex: 0, page: 0, loading: false, error: null });
      return true;
    }

    generation += 1;
    const requestGeneration = generation;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    set({ directory: normalized, entries: [], activeIndex: 0, page: 0, loading: true, error: null });

    try {
      const listing = await adapter.list(normalized, { signal: requestController.signal });
      if (requestGeneration !== generation) return false;
      const entries = toEntries(normalized, listing);
      cache.set(normalized, entries);
      set({ directory: normalized, entries, activeIndex: 0, page: 0, loading: false, error: null });
      return true;
    } catch (cause) {
      if (requestGeneration !== generation) return false;
      set({
        directory: normalized,
        entries: [],
        activeIndex: 0,
        page: 0,
        loading: false,
        error: cause instanceof Error ? cause.message : "Failed to load files",
      });
      return false;
    }
  }

  async function navigate(directory: string): Promise<boolean> {
    const normalized = normalizeDirectory(directory);
    if (normalized === null) return false;
    return load(normalized);
  }

  async function retry(): Promise<boolean> {
    cache.delete(snapshot.directory);
    return load(snapshot.directory);
  }

  function setActiveIndex(index: number): void {
    const count = visibleEntries().length;
    const activeIndex = count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
    set({ activeIndex });
  }

  function moveActive(delta: number): void {
    const count = visibleEntries().length;
    if (count === 0 || delta === 0) return;
    set({ activeIndex: ((snapshot.activeIndex + delta) % count + count) % count });
  }

  function nextPage(delta: number): void {
    if (delta === 0) return;
    const count = pageCount();
    set({ page: ((snapshot.page + delta) % count + count) % count, activeIndex: 0 });
  }

  function toggleSelected(entry = visibleEntries()[snapshot.activeIndex]): boolean {
    if (!entry || entry.isDir || entry.isParent) return false;
    const selected = snapshot.selected.includes(entry.path)
      ? snapshot.selected.filter((path) => path !== entry.path)
      : [...snapshot.selected, entry.path];
    set({ selected });
    return true;
  }

  function confirm(): string | null {
    if (snapshot.selected.length === 0) return null;
    const text = snapshot.selected.map(formatFilePathReference).join("");
    reset();
    return text;
  }

  async function activate(entry = visibleEntries()[snapshot.activeIndex]): Promise<ComposerFilePickerActivation | null> {
    if (!entry) return null;
    if (entry.isDir) {
      await load(entry.path);
      return { kind: "directory", directory: entry.path };
    }
    const text = formatFilePathReference(entry.path);
    reset();
    return { kind: "insert", text };
  }

  return {
    get,
    subscribe,
    useSnapshot: () => useSyncExternalStore(subscribe, get, get),
    load,
    navigate,
    retry,
    reset,
    visibleEntries,
    pageCount,
    setActiveIndex,
    moveActive,
    nextPage,
    activate,
    toggleSelected,
    confirm,
  };
}
