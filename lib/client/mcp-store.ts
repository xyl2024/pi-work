"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewLoadContext,
  type PanelViewStore,
} from "./panel-view-store";
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
  hasDirtyMcpBucket,
  MCP_LIST_PAGE,
  releaseMcpBuckets,
  selectMcpBucket,
  shouldApplyMcpSnapshot,
  withMcpBucket,
  withMcpBucketVerified,
  type McpDraftBucket,
  type McpDraftBuckets,
  type McpPage,
} from "@/lib/shared/mcp-drafts";
import { selectMcpCloseConfirm, selectMcpOpenAction } from "@/lib/shared/mcp-close";
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pagesEqual(a: readonly McpPage[], b: readonly McpPage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((page, index) => {
    const other = b[index];
    if (page.kind === "list" || other.kind === "list") return page.kind === other.kind;
    return page.uid === other.uid;
  });
}

function reconcilePages(pages: readonly McpPage[], entryUids: readonly string[]): McpPage[] {
  const page = pages[pages.length - 1] ?? MCP_LIST_PAGE;
  if (page.kind === "entry" && !entryUids.includes(page.uid)) return [MCP_LIST_PAGE];
  return pages.length > 0 ? [...pages] : [MCP_LIST_PAGE];
}

let nextLoadIsForeground = false;

function mirrorPages(pages: readonly McpPage[]): void {
  const current = mcpPanel.currentPage();
  const target = pages[pages.length - 1] ?? MCP_LIST_PAGE;
  if (target.kind === "list") {
    if (current.kind !== "list") mcpPanel.resetPages();
    return;
  }
  if (current.kind === "entry" && current.uid === target.uid) return;
  if (current.kind === "entry") mcpPanel.resetPages();
  mcpPanel.openPage(target);
}

function commitPages(pages: readonly McpPage[]): void {
  const state = mcpPanel.get();
  if (state.currentCwd === null) return;
  const bucket = selectMcpBucket(state.buckets, state.currentCwd);
  if (!bucket || pagesEqual(bucket.pages, pages)) return;
  mcpPanel.patch({
    buckets: withMcpBucket(state.buckets, { ...bucket, pages: [...pages] }),
  });
}

async function loadMcp(
  cwd: string | null,
  { get, patch, signal }: PanelViewLoadContext<McpStoreState>,
): Promise<void> {
  const foreground = nextLoadIsForeground;
  nextLoadIsForeground = false;

  if (cwd === null) {
    patch({ currentCwd: null, loadingCwd: null, loadError: null, loadErrorCwd: null });
    mirrorPages([MCP_LIST_PAGE]);
    return;
  }

  const before = get();
  const held = selectMcpBucket(before.buckets, cwd);
  const action = selectMcpOpenAction({
    loading: before.loadingCwd === cwd && before.currentCwd === cwd,
    dirty: held?.dirty ?? false,
    hasSnapshot: held !== null,
  });

  if (before.currentCwd !== cwd) {
    patch({ currentCwd: cwd, loadError: null, loadErrorCwd: null });
  }
  mirrorPages(held?.pages ?? [MCP_LIST_PAGE]);

  if (action === "reuse" && !foreground) return;

  const background = action === "show-snapshot" && !foreground;
  if (background) {
    patch({
      loadingCwd: cwd,
      loadError: null,
      loadErrorCwd: null,
      buckets: withMcpBucketVerified(get().buckets, cwd, false),
    });
  } else {
    patch({ loadingCwd: cwd, loadError: null, loadErrorCwd: null });
  }

  try {
    const data = await fetchMcpPanelData(cwd, signal);
    if (signal.aborted) return;

    const heldNow = selectMcpBucket(get().buckets, cwd);
    if (!shouldApplyMcpSnapshot(heldNow)) {
      patch({
        loadingCwd: get().loadingCwd === cwd ? null : get().loadingCwd,
        ...(background
          ? { buckets: withMcpBucketVerified(get().buckets, cwd, true) }
          : {}),
      });
      return;
    }

    const draft = draftFromPanelData(data);
    const pages = reconcilePages(
      heldNow?.pages ?? [MCP_LIST_PAGE],
      draft.entries.map((entry) => entry.uid),
    );
    const bucket: McpDraftBucket = {
      cwd,
      data,
      draft,
      pages,
      dirty: isDraftDirty(draft, data),
      verified: true,
    };
    patch({
      loadingCwd: get().loadingCwd === cwd ? null : get().loadingCwd,
      buckets: withMcpBucket(get().buckets, bucket),
    });
    mirrorPages(pages);
  } catch (e) {
    if (signal.aborted) return;
    const loadingCwd = get().loadingCwd === cwd ? null : get().loadingCwd;
    if (background && selectMcpBucket(get().buckets, cwd)) {
      patch({
        loadingCwd,
        buckets: withMcpBucketVerified(get().buckets, cwd, true),
      });
      return;
    }
    patch({ loadingCwd, loadError: errorMessage(e), loadErrorCwd: cwd });
  }
}

const mcpAdapter: PanelViewAdapter<McpStoreState, McpPage, string | null, string | null> = {
  kind: "mcp",
  initial: INITIAL,
  rootPage: MCP_LIST_PAGE,
  loadPolicy: "on-visible",
  key: (cwd) => cwd,
  load: loadMcp,
  release() {
    nextLoadIsForeground = false;
  },
  afterPages({ pages }) {
    commitPages(pages);
  },
  guard(state): PanelViewCloseGuard | null {
    const confirm = selectMcpCloseConfirm({ dirty: hasDirtyMcpBucket(state.buckets) });
    if (!confirm) return null;
    return {
      ...confirm,
      discard() {
        mcpPanel.patch({ buckets: releaseMcpBuckets() });
      },
    };
  },
  status(state) {
    return hasDirtyMcpBucket(state.buckets);
  },
  isRootPage(pages) {
    return pages.length <= 1;
  },
  isSiblingPage(next, current) {
    return next.kind === "entry" && current.kind === "entry";
  },
};

export const mcpPanel: PanelViewStore<McpStoreState, McpPage, string | null> =
  createPanelViewStore(mcpAdapter);

export function useMcpPanel() {
  return mcpPanel.useSnapshot();
}

export function reloadMcp(): void {
  if (mcpPanel.get().currentCwd === null) return;
  nextLoadIsForeground = true;
  mcpPanel.reload();
}

function currentBucket(): McpDraftBucket | null {
  const state = mcpPanel.get();
  return selectMcpBucket(state.buckets, state.currentCwd);
}

function updateDraft(mutate: (draft: McpDraft) => McpDraft): void {
  const bucket = currentBucket();
  if (!bucket) return;
  const draft = mutate(bucket.draft);
  mcpPanel.patch({
    buckets: withMcpBucket(mcpPanel.get().buckets, {
      ...bucket,
      draft,
      dirty: isDraftDirty(draft, bucket.data),
    }),
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
  mcpPanel.patch({
    buckets: withMcpBucket(mcpPanel.get().buckets, {
      ...bucket,
      draft,
      dirty: isDraftDirty(draft, bucket.data),
    }),
  });
  mcpPanel.resetPages();
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
  mcpPanel.patch({
    buckets: withMcpBucket(mcpPanel.get().buckets, {
      ...bucket,
      draft: added.draft,
      dirty: isDraftDirty(added.draft, bucket.data),
    }),
  });
  mcpPanel.openPage({ kind: "entry", uid: added.uid });
  return added.uid;
}

export function disableGlobalInProject(name: string): void {
  const bucket = currentBucket();
  if (!bucket) return;
  const added = addOverrideDraftEntry(bucket.draft, name);
  mcpPanel.patch({
    buckets: withMcpBucket(mcpPanel.get().buckets, {
      ...bucket,
      draft: added.draft,
      dirty: isDraftDirty(added.draft, bucket.data),
    }),
  });
  mcpPanel.openPage({ kind: "entry", uid: added.uid });
}

export function openMcpEntry(uid: string): void {
  if (!currentBucket()) return;
  mcpPanel.openPage({ kind: "entry", uid });
}

export async function saveMcpChanges(): Promise<{ ok: boolean; error?: string }> {
  const bucket = currentBucket();
  if (!bucket) return { ok: false, error: "no data" };
  if (mcpDraftProblem(bucket.draft)) return { ok: false };

  const changes = mcpPendingChanges(bucket.draft, bucket.data);
  if (changes.length === 0) return { ok: true };

  const scope = mcpPanel.scope();
  mcpPanel.patch({ saving: true, saveError: null });
  try {
    await putMcpPanelChanges(bucket.cwd, changes);
    if (mcpPanel.isReleased()) return { ok: true };

    const latest = selectMcpBucket(scope.get().buckets, bucket.cwd) ?? bucket;
    scope.patch({
      saving: false,
      savedOnce: true,
      buckets: withMcpBucket(scope.get().buckets, { ...latest, dirty: false }),
    });
    mcpPanel.resetPages();
    if (mcpPanel.get().currentCwd === bucket.cwd) reloadMcp();
    return { ok: true };
  } catch (e) {
    const message = errorMessage(e);
    if (mcpPanel.isReleased()) return { ok: false, error: message };
    scope.patch({ saving: false, saveError: message });
    return { ok: false, error: message };
  }
}
