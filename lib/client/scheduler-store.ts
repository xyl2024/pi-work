"use client";

/**
 * Module-scoped holder for the scheduler *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view. Everything the user would notice losing therefore has to
 * live outside that mount: the task list, the selection, the search / filter,
 * the page-stack position, and the task-form draft. That is the whole reason
 * this module exists; ADR-0003 rule 1 gives a concern a module-level store only
 * when its state must outlive a single mount, and this is exactly that case.
 *
 * The rules stay pure and live in `lib/shared/scheduler-pages.ts` (page stack),
 * `lib/shared/scheduler-close.ts` (dirty + close guard) and
 * `lib/shared/scheduler-cadence.ts` (poll tiers). This file is only the wiring
 * — requests, the `useSyncExternalStore` subscription, the "first open loads,
 * later mounts reuse" policy, and the background poll that keeps the right-bar
 * badge honest while the panel is collapsed.
 *
 * Two things deliberately do *not* live here:
 *   • the run history — it is volatile (it is re-read every 2s while a run is
 *     in flight), so caching it would only add a second, possibly stale copy;
 *     the detail page owns it and re-reads on every mount.
 *   • enable / disable — it is a live item (ADR-0009): the toggle writes
 *     through immediately, with no draft and no save bar.
 */

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import {
  createScheduledTask,
  deleteScheduledTask,
  fetchSchedulerModelMeta,
  fetchScheduledTasks,
  patchScheduledTask,
  triggerScheduledTask,
  updateScheduledTask,
} from "./scheduler-io";
import {
  backSchedulerPage,
  createSchedulerPageStack,
  currentSchedulerPage,
  isSchedulerRootPage,
  openSchedulerPage,
  schedulerPagesAfterDelete,
  schedulerPagesAfterSave,
  type SchedulerPage,
} from "@/lib/shared/scheduler-pages";
import {
  isSchedulerFormDirty,
  type SchedulerCloseConfirm,
  selectSchedulerCloseConfirm,
} from "@/lib/shared/scheduler-close";
import { schedulerPollDelayMs } from "@/lib/shared/scheduler-cadence";
import {
  newSchedulerForm,
  parseMaxLifetimeMinutes,
  schedulerFormFromTask,
} from "@/lib/shared/scheduler-form";
import type {
  SchedulerModelMeta,
  SchedulerTaskForm,
  ScheduledTask,
  TaskCreatePayload,
  TaskUpdatePayload,
} from "@/lib/shared/scheduler";
import type { TaskNotification } from "@/lib/shared/notifications";

/** The task-list filters the root page offers. */
export type SchedulerFilter = "all" | "enabled" | "disabled" | "error";

export interface SchedulerStoreState {
  /** A task-list read is in flight. */
  loading: boolean;
  /** A task-list read has completed (the list is real). */
  loaded: boolean;
  /** The last read failed; the list shows this with a retry affordance. */
  loadError: string | null;
  tasks: ScheduledTask[];
  /** The task whose detail page is open, if any (used to highlight the list). */
  selectedTaskId: string | null;
  filter: SchedulerFilter;
  query: string;
  /** The panel's page stack: root → detail → form. */
  pages: SchedulerPage[];
  meta: SchedulerModelMeta | null;
  /** The open form's current values; null when no form is open. */
  form: SchedulerTaskForm | null;
  /** The task the form edits; null = a new task. */
  formTaskId: string | null;
  /** The form's values when it opened — the dirty comparison baseline. */
  formBaseline: SchedulerTaskForm | null;
  saving: boolean;
  saveError: string | null;
  /** A "run now" request is in flight. */
  triggering: boolean;
  /** The scheduler panel body is mounted (its tab is the active one). */
  mounted: boolean;
  /** The mounted panel is showing a task's run history. */
  runsVisible: boolean;
}

const INITIAL: SchedulerStoreState = {
  loading: false,
  loaded: false,
  loadError: null,
  tasks: [],
  selectedTaskId: null,
  filter: "all",
  query: "",
  pages: createSchedulerPageStack(),
  meta: null,
  form: null,
  formTaskId: null,
  formBaseline: null,
  saving: false,
  saveError: null,
  triggering: false,
  mounted: false,
  runsVisible: false,
};

let state: SchedulerStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Content-equality guarded write — a no-op patch never re-renders. */
function patch(partial: Partial<SchedulerStoreState>): void {
  let changed = false;
  for (const key of Object.keys(partial) as (keyof SchedulerStoreState)[]) {
    if (!isContentEqual(partial[key], state[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...partial };
  emit();
}

// ── Background poll ─────────────────────────────────────────────────────
// One loop, shared by every subscriber (the right-bar badge is always one).
// The delay comes from the pure cadence table: fast while a run history is on
// screen, slow while the panel is collapsed, stopped while the tab is hidden.

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;
let polling = false;

function schedulePoll(): void {
  if (!polling) return;
  if (pollTimer) clearTimeout(pollTimer);
  const delay = schedulerPollDelayMs({
    mounted: state.mounted,
    runsVisible: state.runsVisible,
    hidden: typeof document !== "undefined" && document.hidden,
  });
  if (delay === null) return; // hidden — wait for visibilitychange
  pollTimer = setTimeout(() => void poll(), delay);
}

async function poll(): Promise<void> {
  if (!polling) return;
  if (pollInFlight) {
    schedulePoll();
    return;
  }
  pollInFlight = true;
  try {
    const tasks = await fetchScheduledTasks();
    patch({ tasks, loadError: null, loaded: true });
  } catch {
    // Best effort; retain the last known list.
  } finally {
    pollInFlight = false;
    schedulePoll();
  }
}

function onVisibilityChange(): void {
  if (typeof document !== "undefined" && !document.hidden) void poll();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!polling) {
    polling = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    // Kick one read immediately so the badge is honest as soon as the shell
    // mounts, instead of waiting out the collapsed tier first.
    void poll();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && polling) {
      polling = false;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    }
  };
}

function getSnapshot(): SchedulerStoreState {
  return state;
}

function getServerSnapshot(): SchedulerStoreState {
  return INITIAL;
}

export function useSchedulerStore(): SchedulerStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── Derived reads ───────────────────────────────────────────────────────

/** True while any task's last run is still in flight (the right-bar dot). */
export function selectSchedulerRunning(snapshot: SchedulerStoreState): boolean {
  return snapshot.tasks.some((task) => task.lastRunStatus === "running");
}

/** Reactive badge flag — a boolean snapshot keeps the shell from re-rendering
 *  on every other store change, and it stays lit while the panel is collapsed
 *  because the flag lives here, not in the panel mount. */
export function useSchedulerRunning(): boolean {
  return useSyncExternalStore(subscribe, () => selectSchedulerRunning(state), () => false);
}

export function getSchedulerRunning(): boolean {
  return selectSchedulerRunning(state);
}

/** The form's unsaved-changes flag, read from one snapshot. */
export function selectSchedulerDirty(snapshot: SchedulerStoreState): boolean {
  return isSchedulerFormDirty(snapshot.form, snapshot.formBaseline);
}

/** Non-reactive read of the same rule — the shell's close guard asks at confirm time. */
export function getSchedulerDirty(): boolean {
  return selectSchedulerDirty(state);
}

/** The close confirmation the shell shows when the tab may drop a draft. */
export function schedulerCloseGuard(): SchedulerCloseConfirm | null {
  return selectSchedulerCloseConfirm({ dirty: getSchedulerDirty() });
}

// ── Loading ─────────────────────────────────────────────────────────────

async function loadFromDisk(): Promise<void> {
  patch({ loading: true, loadError: null });
  void fetchSchedulerModelMeta()
    .then((meta) => patch({ meta }))
    .catch(() => {});
  try {
    const tasks = await fetchScheduledTasks();
    patch({ loading: false, loaded: true, tasks, loadError: null });
  } catch (e) {
    patch({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Read the list the first time the panel opens. Later mounts reuse it (the
 * background poll keeps it fresh, so there is nothing to re-read); the tab
 * closing releases it, which makes the next open read again.
 */
export function ensureSchedulerLoaded(): void {
  if (state.loaded || state.loading) return;
  void loadFromDisk();
}

/** Re-read the list on demand (the list page's retry / after a CRUD write). */
export async function reloadSchedulerTasks(): Promise<void> {
  await loadFromDisk();
}

/**
 * Drop everything. Called by the shell when the scheduler tab closes: the tab
 * is the lifetime of the list and the draft, so the next open lands back on the
 * task list and reads the freshly-run data instead of resurrecting a stale one.
 * Collapsing the panel or switching tabs does not close the tab.
 */
export function releaseSchedulerState(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

// ── Panel mount signals (drive the poll tier) ────────────────────────────

export function setSchedulerPanelMounted(mounted: boolean): void {
  patch({ mounted });
}

export function setSchedulerRunsVisible(runsVisible: boolean): void {
  patch({ runsVisible });
}

// ── List state ──────────────────────────────────────────────────────────

export function setSchedulerFilter(filter: SchedulerFilter): void {
  patch({ filter });
}

export function setSchedulerQuery(query: string): void {
  patch({ query });
}

// ── Navigation ──────────────────────────────────────────────────────────

/** Open one task's detail page (replacing a sibling detail page). */
export function openSchedulerTask(taskId: string): void {
  patch({
    pages: openSchedulerPage({ kind: "detail", taskId }),
    selectedTaskId: taskId,
    runsVisible: false,
  });
}

/**
 * Open the create / edit form. `task` null creates; otherwise edit. The
 * snapshot taken here is the dirty baseline — a blank new form is therefore
 * not dirty the moment it opens.
 */
export function openSchedulerForm(task: ScheduledTask | null, cwd: string | null): void {
  const form = task ? schedulerFormFromTask(task) : newSchedulerForm(cwd);
  patch({
    pages: openSchedulerPage({ kind: "form", taskId: task?.id ?? null }),
    form,
    formTaskId: task?.id ?? null,
    formBaseline: { ...form },
    saveError: null,
    runsVisible: false,
  });
}

/** Pop one level; the task list is the floor. Leaving a form page discards its
 *  draft, so cancelling (or backing out) never leaves a dirty flag behind. */
export function schedulerBack(): void {
  const leavingForm = currentSchedulerPage(state.pages).kind === "form";
  patch({
    pages: backSchedulerPage(state.pages),
    runsVisible: false,
    ...(leavingForm
      ? { form: null, formTaskId: null, formBaseline: null, saveError: null }
      : {}),
  });
}

/**
 * Run Escape against the page stack: pop one level, or — when the list is
 * already on top — report that the panel tab is free to run its close rules.
 */
export function escapeScheduler(): { closePanel: boolean } {
  if (isSchedulerRootPage(state.pages)) return { closePanel: true };
  schedulerBack();
  return { closePanel: false };
}

// ── Form edits ──────────────────────────────────────────────────────────

export function updateSchedulerForm(partial: Partial<SchedulerTaskForm>): void {
  if (state.form === null) return;
  patch({ form: { ...state.form, ...partial } });
}

function buildNotification(form: SchedulerTaskForm): TaskNotification | null {
  const recipientId = form.recipientId.trim();
  if (!form.notifyEnabled || !recipientId) return null;
  return {
    onSuccess: form.notifySuccess,
    onError: form.notifyError,
    onTimeout: form.notifyTimeout,
    channels: [{ type: form.channelType, channelId: form.channelId || undefined, recipientId }],
  };
}

/**
 * Submit the whole form once (create or update) and land on the saved task's
 * detail page. Validation errors are the form page's job; this returns the
 * server error (or null) so the page can surface it in the visible save bar.
 */
export async function saveSchedulerForm(): Promise<{ ok: boolean; error?: string }> {
  const form = state.form;
  if (form === null) return { ok: false, error: "no form" };
  if (state.saving) return { ok: false };
  const toolNames: string[] | null = form.toolSelection === "all" ? null : form.toolSelection;
  const base = {
    name: form.name.trim(),
    cron: form.cron.trim(),
    cwd: form.cwd.trim(),
    prompt: form.prompt.trim(),
    provider: form.provider.trim() || null,
    modelId: form.modelId.trim() || null,
    thinkingLevel: form.thinkingLevel.trim() || null,
    toolNames,
    notification: buildNotification(form),
    // null = use the runner default; otherwise the parsed ms.
    maxLifetimeMs: form.maxLifetimeMinutes.trim() === "" ? null : parseMaxLifetimeMinutes(form.maxLifetimeMinutes),
    // Cron is wall-clock based; persist the browser's IANA timezone so a
    // UTC-hosted server still runs the task at the time shown in the UI.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  patch({ saving: true, saveError: null });
  try {
    const saved = state.formTaskId
      ? await updateScheduledTask({ id: state.formTaskId, ...base } satisfies TaskUpdatePayload)
      : await createScheduledTask(base satisfies TaskCreatePayload);
    patch({
      saving: false,
      tasks: upsertTask(state.tasks, saved),
      selectedTaskId: saved.id,
      pages: schedulerPagesAfterSave(saved.id),
      form: null,
      formTaskId: null,
      formBaseline: null,
      saveError: null,
      runsVisible: false,
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    patch({ saving: false, saveError: error });
    return { ok: false, error };
  }
}

function upsertTask(tasks: ScheduledTask[], task: ScheduledTask): ScheduledTask[] {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

// ── Live actions (immediate, no draft) ──────────────────────────────────

/** Enable / disable a task. Writes through immediately. */
export async function toggleSchedulerTask(taskId: string, enabled: boolean): Promise<void> {
  const saved = await patchScheduledTask(taskId, enabled);
  patch({ tasks: upsertTask(state.tasks, saved) });
}

/** Delete a task and its run history, then draw the stack back to the list. */
export async function removeSchedulerTask(taskId: string): Promise<void> {
  await deleteScheduledTask(taskId);
  patch({
    tasks: state.tasks.filter((task) => task.id !== taskId),
    pages: schedulerPagesAfterDelete(),
    selectedTaskId: null,
    runsVisible: false,
  });
}

/** Enqueue an immediate run, then refresh the list so the badge lights up. */
export async function triggerSchedulerTaskNow(taskId: string): Promise<void> {
  if (state.triggering) return;
  patch({ triggering: true });
  try {
    await triggerScheduledTask(taskId);
    await reloadSchedulerTasks();
  } finally {
    patch({ triggering: false });
  }
}
