"use client";

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
  browserTimezone,
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
import { subscribeModelIconPreferences } from "@/lib/client/model-icon-preferences";

export type SchedulerFilter = "all" | "enabled" | "disabled" | "error";

export interface SchedulerStoreState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  tasks: ScheduledTask[];
  selectedTaskId: string | null;
  filter: SchedulerFilter;
  query: string;
  pages: SchedulerPage[];
  meta: SchedulerModelMeta | null;
  form: SchedulerTaskForm | null;
  formTaskId: string | null;
  formBaseline: SchedulerTaskForm | null;
  saving: boolean;
  saveError: string | null;
  triggering: boolean;
  panelOpen: boolean;
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
  panelOpen: false,
  runsVisible: false,
};

let state: SchedulerStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

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

subscribeModelIconPreferences((modelIconPreferences) => {
  if (!state.meta) return;
  patch({ meta: { ...state.meta, modelIconPreferences } });
});

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;
let polling = false;
let writeGeneration = 0;
let writesInFlight = 0;

function beginWrite(): void {
  writesInFlight += 1;
  writeGeneration += 1;
}

function endWrite(): void {
  writesInFlight -= 1;
  writeGeneration += 1;
}

function schedulePoll(): void {
  if (!polling) return;
  if (pollTimer) clearTimeout(pollTimer);
  const delay = schedulerPollDelayMs({
    panelOpen: state.panelOpen,
    runsVisible: state.runsVisible,
    hidden: typeof document !== "undefined" && document.hidden,
  });
  if (delay === null) return;
  pollTimer = setTimeout(() => void poll(), delay);
}

async function poll(): Promise<void> {
  if (!polling) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (pollInFlight) {
    schedulePoll();
    return;
  }
  pollInFlight = true;
  const generation = writeGeneration;
  try {
    const tasks = await fetchScheduledTasks();
    if (generation === writeGeneration && writesInFlight === 0) {
      patch({ tasks, loadError: null, loaded: true });
    }
  } catch {
  } finally {
    pollInFlight = false;
    schedulePoll();
  }
}

function onVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.hidden) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    return;
  }
  void poll();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!polling) {
    polling = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
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

export function selectSchedulerRunning(snapshot: SchedulerStoreState): boolean {
  return snapshot.tasks.some((task) => task.lastRunStatus === "running");
}

export function useSchedulerRunning(): boolean {
  return useSyncExternalStore(subscribe, () => selectSchedulerRunning(state), () => false);
}

function selectSchedulerDirty(snapshot: SchedulerStoreState): boolean {
  return isSchedulerFormDirty(snapshot.form, snapshot.formBaseline);
}

function getSchedulerDirty(): boolean {
  return selectSchedulerDirty(state);
}

export function schedulerCloseGuard(): SchedulerCloseConfirm | null {
  return selectSchedulerCloseConfirm({ dirty: getSchedulerDirty() });
}

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

export async function reloadSchedulerTasks(): Promise<void> {
  await loadFromDisk();
}

export function releaseSchedulerState(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

export function setSchedulerPanelOpen(panelOpen: boolean): void {
  patch({ panelOpen });
}

export function setSchedulerRunsVisible(runsVisible: boolean): void {
  patch({ runsVisible });
}

export function setSchedulerFilter(filter: SchedulerFilter): void {
  patch({ filter });
}

export function setSchedulerQuery(query: string): void {
  patch({ query });
}

export function openSchedulerTask(taskId: string): void {
  patch({
    pages: openSchedulerPage({ kind: "detail", taskId }),
    selectedTaskId: taskId,
    runsVisible: false,
  });
}

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

export function escapeScheduler(): { closePanel: boolean } {
  if (isSchedulerRootPage(state.pages)) return { closePanel: true };
  schedulerBack();
  return { closePanel: false };
}

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
    maxLifetimeMs: form.maxLifetimeMinutes.trim() === "" ? null : parseMaxLifetimeMinutes(form.maxLifetimeMinutes),
    timezone: form.timezone.trim() || browserTimezone(),
  };
  patch({ saving: true, saveError: null });
  beginWrite();
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
  } finally {
    endWrite();
  }
}

function upsertTask(tasks: ScheduledTask[], task: ScheduledTask): ScheduledTask[] {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

export async function toggleSchedulerTask(taskId: string, enabled: boolean): Promise<void> {
  beginWrite();
  try {
    const saved = await patchScheduledTask(taskId, enabled);
    patch({ tasks: upsertTask(state.tasks, saved) });
  } finally {
    endWrite();
  }
}

export async function removeSchedulerTask(taskId: string): Promise<void> {
  beginWrite();
  try {
    await deleteScheduledTask(taskId);
    patch({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      pages: schedulerPagesAfterDelete(),
      selectedTaskId: null,
      runsVisible: false,
    });
  } finally {
    endWrite();
  }
}

export async function triggerSchedulerTaskNow(taskId: string): Promise<boolean> {
  if (state.triggering) return false;
  patch({ triggering: true });
  beginWrite();
  try {
    await triggerScheduledTask(taskId);
    await reloadSchedulerTasks();
    return true;
  } finally {
    patch({ triggering: false });
    endWrite();
  }
}
