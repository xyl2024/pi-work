import type { SlashResource } from "@/lib/shared/slash-commands";
import { rankSlashResources } from "@/lib/shared/slash-commands";
import { formatFilePathReference } from "@/lib/shared/file-reference";
import {
  DIRECTORY_PAGE_SIZE,
  createDirectoryListing,
  pageWindow,
  type DirectoryListingAdapter,
  type DirectoryListingEntry,
} from "./directory-listing";

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

export function filterComposerSkills(
  resources: readonly SlashResource[],
  query: string,
): SlashResource[] {
  return rankSlashResources(
    resources.filter((resource) => resource.source === "skill"),
    query,
  );
}

export type ComposerFileEntry = DirectoryListingEntry;
export type ComposerFilePickerAdapter = DirectoryListingAdapter;

export interface ComposerFilePickerSnapshot {
  directory: string;
  entries: ComposerFileEntry[];
  selected: string[];
  activeIndex: number;
  page: number;
  loading: boolean;
  error: string | null;
}

export interface ComposerPickerSnapshot {
  open: boolean;
  view: ComposerPickerView;
  activeIndex: number;
  skillQuery: string;
  file: ComposerFilePickerSnapshot;
}

export interface ComposerPickerActivation {
  action: ComposerPickerAction;
  closed: boolean;
  view: ComposerPickerView;
}

export interface ComposerPickerBackResult {
  closed: boolean;
}

export type ComposerFileActivation =
  | { kind: "directory"; directory: string }
  | { kind: "insert"; text: string };

export interface ComposerPicker {
  get(): ComposerPickerSnapshot;
  subscribe(listener: () => void): () => void;
  open(): void;
  close(): void;
  toggle(): void;
  reset(): void;
  back(): ComposerPickerBackResult;
  openView(view: Exclude<ComposerPickerView, "main">): void;
  setActiveIndex(index: number, itemCount?: number): void;
  moveActive(delta: number, itemCount: number): void;
  activate(index?: number): ComposerPickerActivation | null;
  setSkillQuery(query: string): void;
  selectSkill(resources: readonly SlashResource[]): SlashResource | null;
  loadFileDirectory(directory?: string): Promise<boolean>;
  navigateFileDirectory(directory: string): Promise<boolean>;
  retryFileDirectory(): Promise<boolean>;
  hasFileEntries(): boolean;
  fileVisibleEntries(): ComposerFileEntry[];
  filePageCount(): number;
  setFileActiveIndex(index: number): void;
  moveFileActive(delta: number): void;
  nextFilePage(delta: number): void;
  activateFile(entry?: ComposerFileEntry): Promise<ComposerFileActivation | null>;
  toggleFileSelected(entry?: ComposerFileEntry): boolean;
  confirmFileSelection(): string | null;
}

const EMPTY_FILE: ComposerFilePickerSnapshot = {
  directory: "",
  entries: [],
  selected: [],
  activeIndex: 0,
  page: 0,
  loading: false,
  error: null,
};

const INITIAL: ComposerPickerSnapshot = {
  open: false,
  view: "main",
  activeIndex: 0,
  skillQuery: "",
  file: EMPTY_FILE,
};

const NOOP_ADAPTER: DirectoryListingAdapter = {
  async list() {
    return [];
  },
};

function sameFile(a: ComposerFilePickerSnapshot, b: ComposerFilePickerSnapshot): boolean {
  return a.directory === b.directory
    && a.activeIndex === b.activeIndex
    && a.page === b.page
    && a.loading === b.loading
    && a.error === b.error
    && a.entries === b.entries
    && a.selected === b.selected;
}

function sameSnapshot(a: ComposerPickerSnapshot, b: ComposerPickerSnapshot): boolean {
  return a.open === b.open
    && a.view === b.view
    && a.activeIndex === b.activeIndex
    && a.skillQuery === b.skillQuery
    && sameFile(a.file, b.file);
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(index, 0), itemCount - 1);
}

export function createComposerPicker({
  fileAdapter = NOOP_ADAPTER,
}: {
  fileAdapter?: ComposerFilePickerAdapter;
} = {}): ComposerPicker {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();
  const fileListing = createDirectoryListing({ adapter: fileAdapter });
  let suppressFileSync = false;

  function set(next: ComposerPickerSnapshot): void {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function fileFromListing(current: ComposerFilePickerSnapshot): ComposerFilePickerSnapshot {
    const listing = fileListing.get();
    const directoryChanged = current.directory !== listing.directory;
    const page = pageWindow(
      listing.entries,
      directoryChanged || listing.loading ? 0 : current.page,
      DIRECTORY_PAGE_SIZE,
    );
    return {
      directory: listing.directory,
      entries: listing.entries,
      selected: current.selected,
      activeIndex: clampIndex(
        directoryChanged || listing.loading ? 0 : current.activeIndex,
        page.items.length,
      ),
      page: page.currentPage,
      loading: listing.loading,
      error: listing.error,
    };
  }

  fileListing.subscribe(() => {
    if (suppressFileSync) return;
    set({ ...snapshot, file: fileFromListing(snapshot.file) });
  });

  function replace(next: ComposerPickerSnapshot): void {
    suppressFileSync = true;
    fileListing.reset();
    suppressFileSync = false;
    set(next);
  }

  function get(): ComposerPickerSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function reset(): void {
    replace(INITIAL);
  }

  function open(): void {
    replace({ ...INITIAL, open: true });
  }

  function openView(view: Exclude<ComposerPickerView, "main">): void {
    if (!snapshot.open) return;
    replace({ ...INITIAL, open: true, view });
    if (view === "file") void loadFileDirectory();
  }

  function back(): ComposerPickerBackResult {
    if (!snapshot.open) return { closed: false };
    if (snapshot.view !== "main") {
      replace({ ...INITIAL, open: true });
      return { closed: false };
    }
    reset();
    return { closed: true };
  }

  function setActiveIndex(index: number, itemCount = COMPOSER_PICKER_ITEMS.length): void {
    set({ ...snapshot, activeIndex: clampIndex(index, itemCount) });
  }

  function moveActive(delta: number, itemCount: number): void {
    if (!snapshot.open || itemCount <= 0 || delta === 0) return;
    const next = ((snapshot.activeIndex + delta) % itemCount + itemCount) % itemCount;
    set({ ...snapshot, activeIndex: next });
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

  function setSkillQuery(query: string): void {
    if (snapshot.skillQuery === query) return;
    set({ ...snapshot, skillQuery: query, activeIndex: 0 });
  }

  function selectSkill(resources: readonly SlashResource[]): SlashResource | null {
    if (!snapshot.open || snapshot.view !== "skill") return null;
    const skills = filterComposerSkills(resources, snapshot.skillQuery);
    const skill = skills[clampIndex(snapshot.activeIndex, skills.length)];
    if (!skill) return null;
    reset();
    return skill;
  }

  function filePageCount(): number {
    return pageWindow(snapshot.file.entries, snapshot.file.page, DIRECTORY_PAGE_SIZE).pageCount;
  }

  function fileVisibleEntries(): ComposerFileEntry[] {
    return pageWindow(
      snapshot.file.entries,
      snapshot.file.page,
      DIRECTORY_PAGE_SIZE,
    ).items;
  }

  function hasFileEntries(): boolean {
    return snapshot.file.entries.some((entry) => !entry.isParent);
  }

  function setFileActiveIndex(index: number): void {
    const entries = fileVisibleEntries();
    set({
      ...snapshot,
      file: { ...snapshot.file, activeIndex: clampIndex(index, entries.length) },
    });
  }

  function moveFileActive(delta: number): void {
    const entries = fileVisibleEntries();
    if (entries.length === 0 || delta === 0) return;
    set({
      ...snapshot,
      file: {
        ...snapshot.file,
        activeIndex: ((snapshot.file.activeIndex + delta) % entries.length + entries.length) % entries.length,
      },
    });
  }

  function nextFilePage(delta: number): void {
    if (delta === 0) return;
    const pageCount = filePageCount();
    const page = ((snapshot.file.page + delta) % pageCount + pageCount) % pageCount;
    set({ ...snapshot, file: { ...snapshot.file, page, activeIndex: 0 } });
  }

  function toggleFileSelected(entry = fileVisibleEntries()[snapshot.file.activeIndex]): boolean {
    if (!entry || entry.isDir || entry.isParent) return false;
    const selected = snapshot.file.selected.includes(entry.path)
      ? snapshot.file.selected.filter((path) => path !== entry.path)
      : [...snapshot.file.selected, entry.path];
    set({ ...snapshot, file: { ...snapshot.file, selected } });
    return true;
  }

  function confirmFileSelection(): string | null {
    if (snapshot.file.selected.length === 0) return null;
    const text = snapshot.file.selected.map(formatFilePathReference).join("");
    reset();
    return text;
  }

  async function loadFileDirectory(directory = snapshot.file.directory): Promise<boolean> {
    return fileListing.load(directory);
  }

  async function navigateFileDirectory(directory: string): Promise<boolean> {
    return fileListing.navigate(directory);
  }

  async function retryFileDirectory(): Promise<boolean> {
    return fileListing.retry();
  }

  async function activateFile(
    entry = fileVisibleEntries()[snapshot.file.activeIndex],
  ): Promise<ComposerFileActivation | null> {
    if (!entry) return null;
    if (entry.isDir) {
      await navigateFileDirectory(entry.path);
      return { kind: "directory", directory: entry.path };
    }
    const text = formatFilePathReference(entry.path);
    reset();
    return { kind: "insert", text };
  }

  return {
    get,
    subscribe,
    open,
    close: reset,
    toggle() {
      if (snapshot.open) reset();
      else open();
    },
    reset,
    back,
    openView,
    setActiveIndex,
    moveActive,
    activate,
    setSkillQuery,
    selectSkill,
    loadFileDirectory,
    navigateFileDirectory,
    retryFileDirectory,
    hasFileEntries,
    fileVisibleEntries,
    filePageCount,
    setFileActiveIndex,
    moveFileActive,
    nextFilePage,
    activateFile,
    toggleFileSelected,
    confirmFileSelection,
  };
}
