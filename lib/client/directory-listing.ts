export interface DirectoryListingSourceEntry {
  name: string;
  isDir: boolean;
}

export interface DirectoryListingEntry extends DirectoryListingSourceEntry {
  path: string;
  isParent?: boolean;
}

export interface DirectoryListingAdapter {
  list(
    directory: string,
    options: { signal: AbortSignal },
  ): Promise<readonly DirectoryListingSourceEntry[]>;
}

export interface DirectoryListingSnapshot {
  directory: string;
  entries: DirectoryListingEntry[];
  loading: boolean;
  error: string | null;
}

export interface DirectoryListing {
  get(): DirectoryListingSnapshot;
  subscribe(listener: () => void): () => void;
  load(directory?: string): Promise<boolean>;
  navigate(directory: string): Promise<boolean>;
  retry(): Promise<boolean>;
  reset(): void;
  contentEntries(): DirectoryListingEntry[];
  hasContent(): boolean;
}

export interface PageWindow<T> {
  pageCount: number;
  currentPage: number;
  items: T[];
}

export const DIRECTORY_PAGE_SIZE = 5;

const INITIAL: DirectoryListingSnapshot = {
  directory: "",
  entries: [],
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

function toEntries(
  directory: string,
  listing: readonly DirectoryListingSourceEntry[],
): DirectoryListingEntry[] {
  const entries = listing.map((entry) => ({ ...entry, path: entryPath(directory, entry.name) }));
  return directory
    ? [{ name: "..", path: parentDirectory(directory), isDir: true, isParent: true }, ...entries]
    : entries;
}

function sameSnapshot(a: DirectoryListingSnapshot, b: DirectoryListingSnapshot): boolean {
  return a.directory === b.directory
    && a.loading === b.loading
    && a.error === b.error
    && a.entries === b.entries;
}

export function pageWindow<T>(
  items: readonly T[],
  page: number,
  pageSize: number = DIRECTORY_PAGE_SIZE,
): PageWindow<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const start = currentPage * pageSize;
  return { pageCount, currentPage, items: items.slice(start, start + pageSize) };
}

export function createDirectoryListing({
  adapter,
}: {
  adapter: DirectoryListingAdapter;
}): DirectoryListing {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();
  const cache = new Map<string, DirectoryListingEntry[]>();
  let generation = 0;
  let controller: AbortController | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function get(): DirectoryListingSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function set(next: DirectoryListingSnapshot): void {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    emit();
  }

  function reset(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    cache.clear();
    set(INITIAL);
  }

  function contentEntries(): DirectoryListingEntry[] {
    return snapshot.entries.filter((entry) => !entry.isParent);
  }

  function hasContent(): boolean {
    return contentEntries().length > 0;
  }

  async function load(directory = snapshot.directory): Promise<boolean> {
    const normalized = normalizeDirectory(directory);
    if (normalized === null) return false;

    const cached = cache.get(normalized);
    if (cached) {
      generation += 1;
      controller?.abort();
      controller = null;
      set({ directory: normalized, entries: cached, loading: false, error: null });
      return true;
    }

    generation += 1;
    const requestGeneration = generation;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    set({ directory: normalized, entries: [], loading: true, error: null });

    try {
      const listing = await adapter.list(normalized, { signal: requestController.signal });
      if (requestGeneration !== generation) return false;
      const entries = toEntries(normalized, listing);
      cache.set(normalized, entries);
      set({ directory: normalized, entries, loading: false, error: null });
      return true;
    } catch (cause) {
      if (requestGeneration !== generation) return false;
      set({
        directory: normalized,
        entries: [],
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

  return {
    get,
    subscribe,
    load,
    navigate,
    retry,
    reset,
    contentEntries,
    hasContent,
  };
}
