"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewStore,
} from "./panel-view-store";
import {
  MemoryConflictError,
  createMemoryFile,
  deleteMemoryFile,
  fetchMemoryFile,
  fetchMemoryFiles,
  MemoryDisabledError,
  saveMemoryFile,
} from "./memory-io";
import { errorMessage } from "@/lib/shared/error-message";
import type { MemoryFileEntry } from "@/lib/shared/memory-main-view";
import type { MainViewLeaveIntent } from "@/lib/shared/main-view-leave";
import { registerMainViewLeaveGuard, requestMainViewLeave } from "./main-view-leave";

export type MemoryPage = { kind: "browse" };

export interface MemoryViewState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  disabled: boolean;
  files: MemoryFileEntry[];
  selectedFile: string | null;
  detailLoading: boolean;
  detailError: string | null;
  content: string;
  baseline: string;
  saving: boolean;
  saveError: string | null;
  createError: string | null;
  deleting: boolean;
  deleteError: string | null;
  openedMtime: string | null;
  conflict: { diskContent: string; diskMtime: string } | null;
}

const INITIAL: MemoryViewState = {
  loading: false,
  loaded: false,
  loadError: null,
  disabled: false,
  files: [],
  selectedFile: null,
  detailLoading: false,
  detailError: null,
  content: "",
  baseline: "",
  saving: false,
  saveError: null,
  createError: null,
  deleting: false,
  deleteError: null,
  openedMtime: null,
  conflict: null,
};

const ROOT_PAGE: MemoryPage = { kind: "browse" };

export function isMemoryContentDirty(state: MemoryViewState): boolean {
  return state.selectedFile !== null && state.content !== state.baseline;
}

export function discardMemoryChanges(): void {
  const state = memoryPanel.get();
  if (state.content !== state.baseline) {
    memoryPanel.patch({ content: state.baseline, saveError: null });
  }
}

async function openMemoryFile(file: string | null): Promise<boolean> {
  if (!(await requestMemoryLeave("select_task"))) return false;
  if (file === null) {
    memoryPanel.patch({
      selectedFile: null,
      detailLoading: false,
      detailError: null,
      content: "",
      baseline: "",
      saveError: null,
    });
    return true;
  }
  memoryPanel.patch({
    selectedFile: file,
    detailLoading: true,
    detailError: null,
    content: "",
    baseline: "",
    saveError: null,
    openedMtime: null,
    conflict: null,
  });
  try {
    const detail = await fetchMemoryFile(file);
    if (memoryPanel.get().selectedFile !== file) return true;
    memoryPanel.patch({
      detailLoading: false,
      content: detail.content,
      baseline: detail.content,
      openedMtime: detail.mtime,
    });
  } catch (e) {
    if (memoryPanel.get().selectedFile !== file) return true;
    memoryPanel.patch({ detailLoading: false, detailError: errorMessage(e) });
  }
  return true;
}

export function selectMemoryFile(file: string | null): void {
  void openMemoryFile(file);
}

export function setMemoryContent(content: string): void {
  memoryPanel.patch({ content });
}

export async function saveMemoryChanges(): Promise<void> {
  const state = memoryPanel.get();
  const file = state.selectedFile;
  if (file === null || state.saving || !isMemoryContentDirty(state)) return;
  memoryPanel.patch({ saving: true, saveError: null });
  try {
    await saveMemoryFile(file, state.content, { openedMtime: state.openedMtime });
    const files = await fetchMemoryFiles().catch(() => null);
    memoryPanel.patch({
      saving: false,
      baseline: state.content,
      openedMtime: null,
      conflict: null,
      files: files ?? state.files,
    });
  } catch (e) {
    if (e instanceof MemoryConflictError) {
      memoryPanel.patch({
        saving: false,
        saveError: null,
        conflict: { diskContent: e.content, diskMtime: e.mtime },
      });
      return;
    }
    memoryPanel.patch({ saving: false, saveError: errorMessage(e) });
  }
}

export async function createMemoryCategory(name: string): Promise<void> {
  memoryPanel.patch({ createError: null });
  try {
    await createMemoryFile(name);
    const files = await fetchMemoryFiles().catch(() => null);
    memoryPanel.patch({ files: files ?? memoryPanel.get().files });
    await openMemoryFile(name);
  } catch (e) {
    memoryPanel.patch({ createError: errorMessage(e) });
  }
}

export async function deleteMemoryCategory(file: string): Promise<void> {
  const state = memoryPanel.get();
  if (state.deleting) return;
  memoryPanel.patch({ deleting: true, deleteError: null });
  try {
    await deleteMemoryFile(file);
    const files = await fetchMemoryFiles().catch(() => null);
    memoryPanel.patch({
      deleting: false,
      files: files ?? state.files,
      selectedFile: state.selectedFile === file ? null : state.selectedFile,
      content: "",
      baseline: "",
    });
  } catch (e) {
    memoryPanel.patch({ deleting: false, deleteError: errorMessage(e) });
  }
}

export function resolveMemoryConflict(mode: "overwrite" | "discard"): void {
  const state = memoryPanel.get();
  if (state.conflict === null || state.saving) return;
  if (mode === "discard") {
    memoryPanel.patch({
      content: state.conflict.diskContent,
      baseline: state.conflict.diskContent,
      openedMtime: state.conflict.diskMtime,
      conflict: null,
      saveError: null,
    });
    void fetchMemoryFiles()
      .then((files) => memoryPanel.patch({ files }))
      .catch(() => {});
    return;
  }
  memoryPanel.patch({ saving: true, saveError: null });
  void (async () => {
    try {
      await saveMemoryFile(state.selectedFile ?? "", state.content, { force: true });
      const files = await fetchMemoryFiles().catch(() => null);
      memoryPanel.patch({
        saving: false,
        baseline: state.content,
        openedMtime: null,
        conflict: null,
        files: files ?? state.files,
      });
    } catch (e) {
      memoryPanel.patch({ saving: false, saveError: errorMessage(e) });
    }
  })();
}

function requestMemoryLeave(intent: MainViewLeaveIntent): Promise<boolean> {
  return requestMainViewLeave({ view: "memory", intent });
}

const memoryAdapter: PanelViewAdapter<MemoryViewState, MemoryPage, void, void> = {
  kind: "memory",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: () => "memory",
  release() {},
  async load(_key, { patch, signal }) {
    patch({ loading: true, loaded: false, loadError: null, disabled: false, files: [] });
    try {
      const files = await fetchMemoryFiles(signal);
      patch({ loading: false, loaded: true, files });
    } catch (e) {
      if (e instanceof MemoryDisabledError) {
        patch({ loading: false, loaded: true, disabled: true });
        return;
      }
      patch({ loading: false, loaded: true, loadError: errorMessage(e) });
    }
  },
};

export const memoryPanel: PanelViewStore<MemoryViewState, MemoryPage, void> =
  createPanelViewStore(memoryAdapter);

registerMainViewLeaveGuard("memory", {
  dirty: () => isMemoryContentDirty(memoryPanel.get()),
  discard: discardMemoryChanges,
});

export function useMemoryPanel() {
  return memoryPanel.useSnapshot();
}
