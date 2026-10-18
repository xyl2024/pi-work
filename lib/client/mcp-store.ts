"use client";

/**
 * Module-scoped holder for the MCP *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view; and collapsing the panel merely animates its width, so the
 * body can stay mounted while invisible. Everything the user would notice losing
 * therefore has to live outside that mount: the drafts, the page-stack position
 * and the last-read file snapshots. That is the whole reason this module exists.
 *
 * The rules stay pure and live in `lib/shared/mcp-drafts.ts` (per-cwd buckets),
 * `lib/shared/mcp-pages.ts` (page stack) and `lib/shared/mcp-close.ts` (close
 * guard + reopen policy). This file is only the wiring — requests, the
 * `useSyncExternalStore` subscription, the per-cwd load, the save, and the
 * bucket lifetime — which ADR-0003 rule 3 leaves to the manual checklist.
 *
 * Two policies matter, and ADR-0018 records why they differ from the
 * models-config / skills siblings:
 *
 *   • drafts are bucketed by cwd. Leaving a cwd parks its dirty draft and drops
 *     its clean one; the badge and the close guard both read "any cwd dirty",
 *     because closing the tab releases every bucket.
 *   • a clean panel re-reads disk on every re-open (`selectMcpOpenAction`).
 *     `mcp.json` has more than one writer, and every save is a read-modify-write
 *     that never assumes its own snapshot is current.
 */

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
  parkMcpBucket,
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
  /** The working directory the panel is showing; null before the first read. */
  currentCwd: string | null;
  /** Live drafts, keyed by cwd. Parked dirty buckets survive a session switch. */
  buckets: McpDraftBuckets;
  /** The cwd whose read is in flight, null when none is. */
  loadingCwd: string | null;
  /** The last read failed; shown only while `loadErrorCwd` is the current cwd. */
  loadError: string | null;
  /** The cwd `loadError` belongs to. Keeps a stale error from another cwd off screen. */
  loadErrorCwd: string | null;
  /** The save request is in flight. */
  saving: boolean;
  /** The last save failed; the footer shows this. */
  saveError: string | null;
  /** A save has succeeded at least once in this tab's lifetime. */
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

/** Bumped on every load and on release; a late response older than the bump is dropped. */
let loadSeq = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

/** Content-equality guarded write — a no-op patch never re-renders. */
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

// ── Loading ─────────────────────────────────────────────────────────────

async function load(cwd: string, background = false): Promise<void> {
  const seq = ++loadSeq;
  if (background) {
    // A snapshot is already on screen: show it with a "checking" hint instead of
    // blanking the panel, and let the reconcile replace it when it lands.
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
    // The user edited this cwd while the read was in flight (a parked dirty
    // draft came back). Their edits win; the next save / open re-reads.
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
    // A reconcile behind a snapshot fails quietly: keeping the last read is
    // better than replacing it with an error screen.
    if (background && selectMcpBucket(state.buckets, cwd)) {
      patch({ loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd, buckets: withMcpBucketVerified(state.buckets, cwd, true) });
      return;
    }
    patch({ loadingCwd: state.loadingCwd === cwd ? null : state.loadingCwd, loadError: errorMessage(e), loadErrorCwd: cwd });
  }
}

/**
 * Make the store's view `cwd`'s. A different cwd parks the previous one (only
 * when dirty); the same cwd with a dirty draft reuses it, while a clean one
 * re-reads — the panel never shows a snapshot it cannot prove is current.
 */
export function ensureMcpLoaded(cwd: string | null): void {
  if (cwd === null) {
    if (state.currentCwd !== null) patch({ currentCwd: null, loadingCwd: null, loadError: null, loadErrorCwd: null });
    return;
  }

  const bucket = selectMcpBucket(state.buckets, cwd);
  const loading = state.loadingCwd === cwd;
  const action = selectMcpOpenAction({ loading, dirty: bucket?.dirty ?? false, hasSnapshot: bucket !== null });

  if (state.currentCwd !== cwd) {
    patch({
      currentCwd: cwd,
      buckets: parkMcpBucket(state.buckets, state.currentCwd),
      loadError: null,
      loadErrorCwd: null,
    });
  }
  if (action === "reuse") return;
  // A snapshot is shown immediately; only a cwd we have never read blocks.
  void load(cwd, action === "show-snapshot");
}

/** Force a fresh read of the current cwd — the list's retry affordance. */
export function reloadMcp(): void {
  if (state.currentCwd === null) return;
  void load(state.currentCwd);
}

/**
 * Drop every bucket and the page stacks. Called by the shell when the MCP tab
 * closes: the tab is the lifetime of the store, so the next open reads disk
 * again. The dirty cases get here only after the close guard was confirmed.
 */
export function releaseMcpState(): void {
  if (state === INITIAL) return;
  loadSeq += 1;
  state = { ...INITIAL, buckets: releaseMcpBuckets() };
  emit();
}

// ── Dirty predicate (badge + close guard, one source) ───────────────────

/** Whether any cwd holds unsaved changes. Read by the shell's close guard. */
export function getMcpDirty(): boolean {
  return hasDirtyMcpBucket(state.buckets);
}

/** Same predicate, subscribed — drives the right-bar badge while collapsed. */
export function useMcpDirty(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasDirtyMcpBucket(state.buckets),
    () => false,
  );
}

// ── Draft edits ─────────────────────────────────────────────────────────

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

/** Move a brand-new entry between the two files (the scope picker). */
export function setMcpEntryScope(uid: string, scope: McpScope): void {
  mapEntry(uid, (entry) => ({ ...entry, scope }));
}

/** Drop a draft that was never on disk — a new server the user cancelled. */
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

/** Append a new server draft and open its entry page; returns the new uid. */
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

/**
 * Add a project override that turns a global server off for this working
 * directory, and open its page so the pending change (and the save button) are
 * visible. Nothing is written until Save, same as every other edit.
 */
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

// ── Navigation ──────────────────────────────────────────────────────────

export function openMcpEntry(uid: string): void {
  const bucket = currentBucket();
  if (!bucket) return;
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: openMcpEntryPage(uid) }) });
}

/** The entry page's back control: pop one level, never below the list. */
export function backMcpPageAction(): void {
  const bucket = currentBucket();
  if (!bucket) return;
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: backPageStack(bucket.pages) }) });
}

/** Escape at an entry page pops one level; at the list it leaves the panel. */
export function escapeMcp(): { closePanel: boolean } {
  const bucket = currentBucket();
  if (!bucket || isMcpListPage(bucket.pages)) return { closePanel: true };
  patch({ buckets: withMcpBucket(state.buckets, { ...bucket, pages: backPageStack(bucket.pages) }) });
  return { closePanel: false };
}

// ── Save ────────────────────────────────────────────────────────────────

/**
 * Write this cwd's pending changes in one request. The confirmation is shown by
 * the panel before calling; the server validates every change before touching a
 * single file, so a rejected save leaves the drafts in place and the files
 * untouched. A successful save draws the stack back to the list and re-reads.
 */
export async function saveMcpChanges(): Promise<{ ok: boolean; error?: string }> {
  const bucket = currentBucket();
  if (!bucket) return { ok: false, error: "no data" };
  if (mcpDraftProblem(bucket.draft)) return { ok: false };

  const changes = mcpPendingChanges(bucket.draft, bucket.data);
  if (changes.length === 0) return { ok: true };

  patch({ saving: true, saveError: null });
  try {
    await putMcpPanelChanges(bucket.cwd, changes);
    // A successful PUT means the draft now equals disk, so the bucket is clean —
    // set that before the re-read, otherwise the load guard would mistake it for
    // a user edit made mid-flight and keep the stale snapshot.
    patch({
      saving: false,
      savedOnce: true,
      buckets: withMcpBucket(state.buckets, { ...bucket, pages: mcpPagesAfterSave(), dirty: false }),
    });
    // Only pull the fresh copy when this cwd is still the one on screen; a save
    // that resolves after the user switched sessions must not yank them back.
    if (state.currentCwd === bucket.cwd) await load(bucket.cwd);
    return { ok: true };
  } catch (e) {
    const message = errorMessage(e);
    patch({ saving: false, saveError: message });
    return { ok: false, error: message };
  }
}
