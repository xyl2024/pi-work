"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import { fetchMcpPanelData, putMcpPanelChanges } from "./mcp-io";
import {
  addDraftEntry,
  addOverrideDraftEntry,
  draftFromPanelData,
  isDraftDirty,
  mcpDraftProblem,
  mcpPendingChanges,
  withEntryConfig,
  withEntryRawJson,
  type McpDraft,
  type McpDraftEntry,
} from "@/lib/shared/mcp-draft";
import {
  backMcpPage as backPageStack,
  createMcpPageStack,
  isMcpListPage,
  mcpPagesAfterDelete,
  mcpPagesAfterSave,
  openMcpEntryPage,
  reconcileMcpPages,
} from "@/lib/shared/mcp-pages";
import {
  hasDirtyMcpBucket,
  releaseMcpBuckets,
  selectMcpBucket,
  shouldApplyMcpSnapshot,
  withMcpBucket,
  withMcpBucketVerified,
  type McpDraftBucket,
  type McpDraftBuckets,
} from "@/lib/shared/mcp-drafts";
import { selectMcpOpenAction } from "@/lib/shared/mcp-close";
import type { McpScope } from "@/lib/shared/mcp-panel";

export interface McpStoreState {
  currentCwd: string | null;
  buckets: McpDraftBuckets;
  loadingCwd: string | null;
  loadError: string | null;
  loadErrorCwd: string | null;
  saving: boolean;
  saveError: string | null;
  savedOnce: boolean;
}

const INITIAL: McpStoreState = {
  currentCwd: null,
  buckets: {},
  loadingCwd: null,
  loadError: null,
  loadErrorCwd: null,
  saving: false,
  saveError: null,
  savedOnce: false,
};

let state: McpStoreState = INITIAL;
const listeners = new Set<() => void>();

let loadSeq = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(partial: Partial<McpStoreState>): void {
  let changed = false;
  for (const key of Object.keys(partial) as (keyof McpStoreState)[]) {
    if (!isContentEqual(partial[key], state[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...partial };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): McpStoreState {
  return state;
}

function getServerSnapshot(): McpStoreState {
  return INITIAL;
}

export function useMcpStore(): McpStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load(cwd: string, background = false): Promise<void> {
  const seq = ++loadSeq;
  if (background) {
    patch({
      loadingCwd: cwd,
      loadError: null,
      loadErrorCwd: null,
      buckets: withMcpBucketVerified(state.buckets, cwd, false),
    });
  } else {
    patch({ currentCwd: cwd, loadingCwd: cwd, loadError: null, loadErrorCwd: null });
  }
  try {
    const data = await fetchMcpPanelData(cwd);
    if (seq !== loadSeq) return;
    const held = selectMcpBucket(state.buckets, cwd);
    if (!shouldApplyMcpSnapshot(held)) {
      patch({ loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd });
      if (background) patch({ buckets: withMcpBucketVerified(state.buckets, cwd, true) });
      return;
    }
    const draft = draftFromPanelData(data);
    const pages = reconcileMcpPages(
      held?.pages ?? createMcpPageStack(),
      draft.entries.map((entry) => entry.uid),
    );
    const bucket: McpDraftBucket = { cwd, data, draft, pages, dirty: isDraftDirty(draft, data), verified: true };
    patch({
      loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd,
      buckets: withMcpBucket(state.buckets, bucket),
    });
  } catch (e) {
    if (seq !== loadSeq) return;
    if (background && selectMcpBucket(state.buckets, cwd)) {
      patch({ loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd, buckets: withMcpBucketVerified(state.buckets, cwd, true) });
      return;
    }
    patch({ loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd, loadError: errorMessage(e), loadErrorCwd: cwd });
  }
}

export function ensureMcpLoaded(cwd: string | null): void {
  if (cwd === null) {
    if (state.currentCwd !== null) patch({ currentCwd: null, loadingCwd: null, loadError: null, loadErrorCwd: null });
    return;
  }

  const bucket = selectMcpBucket(state.buckets, cwd);
  const loading = state.loadingCwd === cwd;
  const action = selectMcpOpenAction({ loading, dirty: bucket?.dirty ?? false, hasSnapshot: bucket !== null });

  if (state.currentCwd !== cwd) {
    patch({ currentCwd: cwd, loadError: null, loadErrorCwd: null });
  }
  if (action === "reuse") return;
  void load(cwd, action === "show-snapshot");
}

export function reloadMcp(): void {
  if (state.currentCwd === null) return;
  void load(state.currentCwd);
}

export function releaseMcpState(): void {
  if (state === INITIAL) return;
  loadSeq += 1;
  state = { ...INITIAL, buckets: releaseMcpBuckets() };
  emit();
}

export function getMcpDirty(): boolean {
  return hasDirtyMcpBucket(state.buckets);
}

export function useMcpDirty(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasDirtyMcpBucket(state.buckets),
    () => false,
  );
}

function currentBucket(): McpDraftBucket | null {
  return selectMcpBucket(state.buckets, state.currentCwd);
}

function updateDraft(mutate: (draft: McpDraft) => McpDraft): void {
  const bucket = currentBucket();
  if (!bucket) return;
  const draft = mutate(bucket.draft);
  patch({
    buckets: withMcpBucket(state.buckets, { ...bucket, draft, dirty: isDraftDirty(draft, bucket.data) }),
  });
}

function mapEntry(uid: string, edit: (entry: McpDraftEntry) => McpDraftEntry): void {
  updateDraft((draft) => ({
    ...draft,
    entries: draft.entries.map((entry) => (entry.uid === uid ? edit(entry) : entry)),
  }));
}

export function setMcpEntryName(uid: string, name: string): void {
  mapEntry(uid, (entry) => ({ ...entry, name }));
}

export function setMcpEntryConfig(uid: string, config: Record<string, unknown>): void {
  mapEntry(uid, (entry) => withEntryConfig(entry, config));
}

export function setMcpEntryRawJson(uid: string, text: string): void {
  mapEntry(uid, (entry) => withEntryRawJson(entry, text));
}

export function setMcpEntryDeleted(uid: string, deleted: boolean): void {
  mapEntry(uid, (entry) => ({ ...entry, deleted }));
}

export function setMcpEntryScope(uid: string, scope: McpScope): void {
  mapEntry(uid, (entry) => ({ ...entry, scope }));
}

export function dropMcpEntry(uid: string): void {
  const bucket = currentBucket();
  if (!bucket) return;
  const draft: McpDraft = {
    ...bucket.draft,
    entries: bucket.draft.entries.filter((entry) => entry.uid !== uid),
  };
  patch({
    buckets: withMcpBucket(state.buckets, {
      ...bucket,
      draft,
      pages: mcpPagesAfterDelete(),
      dirty: isDraftDirty(draft, bucket.data),
    }),
  });
}

export function setMcpAutoEnable(scope: McpScope, value: boolean): void {
  updateDraft((draft) => ({
    ...draft,
    autoEnableCodemode: { ...draft.autoEnableCodemode, [scope]: value },
  }));
}

export function addMcpServer(scope: McpScope): string | null {
  const bucket = currentBucket();
  if (!bucket) return null;
  const added = addDraftEntry(bucket.draft, scope);
  patch({
    buckets: withMcpBucket(state.buckets, {
      ...bucket,
      draft: added.draft,
      pages: openMcpEntryPage(added.uid),
      dirty: isDraftDirty(added.draft, bucket.data),
    }),
  });
  return added.uid;
}

export function disableGlobalInProject(name: string): void {
  const bucket = currentBucket();
  if (!bucket) return;
  const added = addOverrideDraftEntry(bucket.draft, name);
  patch({
    buckets: withMcpBucket(state.buckets, {
      ...bucket,
      draft: added.draft,
      pages: openMcpEntryPage(added.uid),
      dirty: isDraftDirty(added.draft, bucket.data),
    }),
  });
}

export function openMcpEntry(uid: string): void {
  const bucket = currentBucket();
  if (!bucket) return;
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: openMcpEntryPage(uid) }) });
}

export function backMcpPageAction(): void {
  const bucket = currentBucket();
  if (!bucket) return;
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: backPageStack(bucket.pages) }) });
}

export function escapeMcp(): { closePanel: boolean } {
  const bucket = currentBucket();
  if (!bucket || isMcpListPage(bucket.pages)) return { closePanel: true };
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: backPageStack(bucket.pages) }) });
  return { closePanel: false };
}

export async function saveMcpChanges(): Promise<{ ok: boolean; error?: string }> {
  const bucket = currentBucket();
  if (!bucket) return { ok: false, error: "no data" };
  if (mcpDraftProblem(bucket.draft)) return { ok: false };

  const changes = mcpPendingChanges(bucket.draft, bucket.data);
  if (changes.length === 0) return { ok: true };

  patch({ saving: true, saveError: null });
  try {
    await putMcpPanelChanges(bucket.cwd, changes);
    patch({
      saving: false,
      savedOnce: true,
      buckets: withMcpBucket(state.buckets, { ...bucket, pages: mcpPagesAfterSave(), dirty: false }),
    });
    if (state.currentCwd === bucket.cwd) await load(bucket.cwd);
    return { ok: true };
  } catch (e) {
    const message = errorMessage(e);
    patch({ saving: false, saveError: message });
    return { ok: false, error: message };
  }
}
