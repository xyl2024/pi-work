"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewStore,
} from "./panel-view-store";
import { fetchMemoryFile, fetchMemoryFiles, MemoryDisabledError, saveMemoryFile } from "./memory-io";
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
  });
  try {
    const detail = await fetchMemoryFile(file);
    if (memoryPanel.get().selectedFile !== file) return true;
    memoryPanel.patch({
      detailLoading: false,
      content: detail.content,
      baseline: detail.content,
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
    await saveMemoryFile(file, state.content);
    const files = await fetchMemoryFiles().catch(() => null);
    memoryPanel.patch({
      saving: false,
      baseline: state.content,
      files: files ?? state.files,
    });
  } catch (e) {
    memoryPanel.patch({ saving: false, saveError: errorMessage(e) });
  }
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
