"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewStore,
  type PanelViewWriter,
} from "./panel-view-store";
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
  isSchedulerFormDirty,
  selectSchedulerCloseConfirm,
} from "@/lib/shared/scheduler-close";
import { schedulerPollDelayMs } from "@/lib/shared/scheduler-cadence";
import {
  browserTimezone,
  newSchedulerForm,
  parseMaxLifetimeMinutes,
  schedulerFormFromTask,
} from "@/lib/shared/scheduler-form";
import { subscribeModelIconPreferences } from "@/lib/client/model-icon-preferences";
import type {
  SchedulerModelMeta,
  SchedulerTaskForm,
  ScheduledTask,
  TaskCreatePayload,
  TaskUpdatePayload,
} from "@/lib/shared/scheduler";
import type { TaskNotification } from "@/lib/shared/notifications";

export type SchedulerFilter = "all" | "enabled" | "disabled" | "error";

export type SchedulerPage =
  | { kind: "root" }
  | { kind: "detail"; taskId: string }
  | { kind: "form"; taskId: string | null };

export interface SchedulerViewState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  tasks: ScheduledTask[];
  selectedTaskId: string | null;
  filter: SchedulerFilter;
  query: string;
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

const ROOT_PAGE: SchedulerPage = { kind: "root" };

const INITIAL: SchedulerViewState = {
  loading: false,
  loaded: false,
  loadError: null,
  tasks: [],
  selectedTaskId: null,
  filter: "all",
  query: "",
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;
let polling = false;
let pollWriter: PanelViewWriter<SchedulerViewState> | null = null;
let unsubscribeIconPreferences: (() => void) | null = null;
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
  const writer = pollWriter;
  if (!writer) return;
  const view = writer.get();
  const delay = schedulerPollDelayMs({
    panelOpen: view.panelOpen,
    runsVisible: view.runsVisible,
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
    const writer = pollWriter;
    if (writer && polling && generation === writeGeneration && writesInFlight === 0) {
      writer.patch({ tasks, loadError: null, loaded: true });
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

function clearPollingResources(): void {
  polling = false;
  pollWriter = null;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  unsubscribeIconPreferences?.();
  unsubscribeIconPreferences = null;
}

export function setSchedulerPanelOpen(panelOpen: boolean): void {
  schedulerPanel.patch({ panelOpen });
}

export function setSchedulerRunsVisible(runsVisible: boolean): void {
  schedulerPanel.patch({ runsVisible });
}

export function setSchedulerFilter(filter: SchedulerFilter): void {
  schedulerPanel.patch({ filter });
}

export function setSchedulerQuery(query: string): void {
  schedulerPanel.patch({ query });
}

export function openSchedulerTask(taskId: string): void {
  schedulerPanel.openPage({ kind: "detail", taskId });
  schedulerPanel.patch({ selectedTaskId: taskId, runsVisible: false });
}

export function openSchedulerForm(task: ScheduledTask | null, cwd: string | null): void {
  const form = task ? schedulerFormFromTask(task) : newSchedulerForm(cwd);
  const page: SchedulerPage = { kind: "form", taskId: task?.id ?? null };
  if (page.taskId === null) schedulerPanel.resetPages();
  schedulerPanel.openPage(page);
  schedulerPanel.patch({
    form,
    formTaskId: task?.id ?? null,
    formBaseline: { ...form },
    saveError: null,
    runsVisible: false,
  });
}

export function updateSchedulerForm(partial: Partial<SchedulerTaskForm>): void {
  const form = schedulerPanel.get().form;
  if (form === null) return;
  schedulerPanel.patch({ form: { ...form, ...partial } });
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
  const scope = schedulerPanel.scope();
  const form = scope.get().form;
  if (form === null) return { ok: false, error: "no form" };
  if (scope.get().saving) return { ok: false };
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
  scope.patch({ saving: true, saveError: null });
  beginWrite();
  try {
    const formTaskId = scope.get().formTaskId;
    const saved = formTaskId
      ? await updateScheduledTask({ id: formTaskId, ...base } satisfies TaskUpdatePayload)
      : await createScheduledTask(base satisfies TaskCreatePayload);
    scope.patch({ saving: false, selectedTaskId: saved.id, saveError: null, runsVisible: false });
    schedulerPanel.resetPages();
    schedulerPanel.openPage({ kind: "detail", taskId: saved.id });
    scope.patch({
      tasks: upsertTask(scope.get().tasks, saved),
      form: null,
      formTaskId: null,
      formBaseline: null,
    });
    return { ok: true };
  } catch (e) {
    const error = errorMessage(e);
    scope.patch({ saving: false, saveError: error });
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
  const scope = schedulerPanel.scope();
  beginWrite();
  try {
    const saved = await patchScheduledTask(taskId, enabled);
    scope.patch({ tasks: upsertTask(scope.get().tasks, saved) });
  } finally {
    endWrite();
  }
}

export async function removeSchedulerTask(taskId: string): Promise<void> {
  const scope = schedulerPanel.scope();
  beginWrite();
  try {
    await deleteScheduledTask(taskId);
    scope.patch({
      tasks: scope.get().tasks.filter((task) => task.id !== taskId),
      selectedTaskId: null,
      runsVisible: false,
    });
    schedulerPanel.resetPages();
  } finally {
    endWrite();
  }
}

export async function triggerSchedulerTaskNow(taskId: string): Promise<boolean> {
  const scope = schedulerPanel.scope();
  if (scope.get().triggering) return false;
  scope.patch({ triggering: true });
  beginWrite();
  try {
    await triggerScheduledTask(taskId);
    schedulerPanel.reload();
    return true;
  } finally {
    scope.patch({ triggering: false });
    endWrite();
  }
}

const schedulerAdapter: PanelViewAdapter<SchedulerViewState, SchedulerPage, void, string> = {
  kind: "scheduler",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "on-open",
  key: () => "scheduler",
  async load(_key, { patch }) {
    patch({ loading: true, loadError: null });
    void fetchSchedulerModelMeta()
      .then((meta) => patch({ meta }))
      .catch(() => {});
    try {
      const tasks = await fetchScheduledTasks();
      patch({ loading: false, loaded: true, tasks, loadError: null });
    } catch (e) {
      patch({ loading: false, loadError: errorMessage(e) });
    }
  },
  start(writer) {
    pollWriter = writer;
    polling = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    unsubscribeIconPreferences = subscribeModelIconPreferences((modelIconPreferences) => {
      const meta = writer.get().meta;
      if (!meta) return;
      writer.patch({ meta: { ...meta, modelIconPreferences } });
    });
    void poll();
  },
  stop() {
    clearPollingResources();
  },
  release() {
    clearPollingResources();
  },
  afterBack({ popped, writer }) {
    if (popped?.kind === "form") {
      writer.patch({ form: null, formTaskId: null, formBaseline: null, saveError: null });
    }
    writer.patch({ runsVisible: false });
  },
  guard(state): PanelViewCloseGuard | null {
    const confirm = selectSchedulerCloseConfirm({
      dirty: isSchedulerFormDirty(state.form, state.formBaseline),
    });
    if (!confirm) return null;
    return { ...confirm, discard: () => {} };
  },
  status(state) {
    return state.tasks.some((task) => task.lastRunStatus === "running");
  },
  isRootPage(pages) {
    return pages.length <= 1;
  },
  isSiblingPage(next, current) {
    return next.kind === "detail" && current.kind === "detail";
  },
};

export const schedulerPanel: PanelViewStore<SchedulerViewState, SchedulerPage, void> =
  createPanelViewStore(schedulerAdapter);

export function useSchedulerPanel() {
  return schedulerPanel.useSnapshot();
}
