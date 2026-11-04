"use client";

import { createPanelViewStore, type PanelViewAdapter } from "./panel-view-store";
import { errorMessage } from "@/lib/shared/error-message";
import type { MemoryEntriesResponse } from "@/lib/shared/memory";

export interface MemoryViewContext {
  cwd: string | null;
}

export interface MemoryViewState {
  loading: boolean;
  loaded: boolean;
  response: MemoryEntriesResponse | null;
  loadError: string | null;
}

type MemoryPage = { kind: "root" };

const ROOT_PAGE: MemoryPage = { kind: "root" };

const INITIAL: MemoryViewState = {
  loading: false,
  loaded: false,
  response: null,
  loadError: null,
};

export function memoryEntriesUrl(cwd: string | null): string {
  return cwd === null ? "/api/memory/entries" : `/api/memory/entries?cwd=${encodeURIComponent(cwd)}`;
}

const memoryAdapter: PanelViewAdapter<MemoryViewState, MemoryPage, MemoryViewContext, string | null> = {
  kind: "memory",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: (context) => context.cwd,
  async load(key, { patch }) {
    patch({ loading: true, response: null, loadError: null });
    try {
      const result = await fetch(memoryEntriesUrl(key));
      const body = (await result.json().catch(() => ({}))) as
        & Partial<MemoryEntriesResponse>
        & { error?: string };
      if (!result.ok || body.error || !body.memory || !body.user) {
        throw new Error(body.error ?? `HTTP ${result.status}`);
      }
      patch({
        loading: false,
        loaded: true,
        response: body as MemoryEntriesResponse,
        loadError: null,
      });
    } catch (error) {
      patch({ loading: false, response: null, loadError: errorMessage(error) });
    }
  },
  release() {},
  guard: () => null,
  status: () => null,
};

export const memoryPanel = createPanelViewStore(memoryAdapter);

export function openMemory(context: MemoryViewContext): void {
  memoryPanel.open(context);
}

export function applyMemoryResponse(response: MemoryEntriesResponse): void {
  memoryPanel.patch({ response, loadError: null });
}

export function useMemoryPanel() {
  return memoryPanel.useSnapshot();
}
