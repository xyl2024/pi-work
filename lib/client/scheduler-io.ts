"use client";

/**
 * HTTP wiring for the scheduler panel view.
 *
 * Every request the panel makes lives here so a contract change (a new field,
 * a different error shape) lands in one place instead of being duplicated
 * across pages. The task record types come from `lib/shared/scheduler` — the
 * wire format the server actually returns.
 */

import type {
  SchedulerModelMeta,
  ScheduledTask,
  TaskCreatePayload,
  TaskRun,
  TaskUpdatePayload,
} from "@/lib/shared/scheduler";

/**
 * Thin fetch wrapper. Cron expressions represent wall-clock time, so the
 * browser's IANA zone rides along on every call; errors carry the server's
 * message so the UI can show it verbatim.
 */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Pi-Work-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = data.error;
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET every scheduled task. */
export async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  const data = await request<{ tasks?: ScheduledTask[] }>("/api/scheduled-tasks");
  return data.tasks ?? [];
}

/** GET one task's run history (newest first, server-limited). */
export async function fetchTaskRuns(taskId: string): Promise<TaskRun[]> {
  const data = await request<{ runs?: TaskRun[] }>(
    `/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs`,
  );
  return data.runs ?? [];
}

/** Enqueue an immediate run of an existing task. */
export async function triggerScheduledTask(taskId: string): Promise<void> {
  await request(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/run`, { method: "POST" });
}

/** Flip a task's enabled flag. Returns the persisted task. */
export async function patchScheduledTask(taskId: string, enabled: boolean): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "PATCH",
    body: JSON.stringify({ id: taskId, enabled }),
  });
  return data.task;
}

/** Create a task and return the persisted record. */
export async function createScheduledTask(payload: TaskCreatePayload): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.task;
}

/** Update a task and return the persisted record. */
export async function updateScheduledTask(payload: TaskUpdatePayload): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.task;
}

/** Delete a task and its run history. */
export async function deleteScheduledTask(taskId: string): Promise<void> {
  await request(`/api/scheduled-tasks?id=${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

/** GET the model catalog the form's model / thinking selectors read. */
export async function fetchSchedulerModelMeta(): Promise<SchedulerModelMeta> {
  const data = await request<Partial<SchedulerModelMeta>>("/api/models");
  return {
    modelList: data.modelList ?? [],
    thinkingLevels: data.thinkingLevels ?? {},
    thinkingLevelMaps: data.thinkingLevelMaps ?? {},
    defaultModel: data.defaultModel ?? null,
    modelIcons: data.modelIcons ?? {},
    modelIconPreferences: data.modelIconPreferences ?? {},
  };
}

/** One WeChat channel as the notification form / overview needs it. */
export interface SchedulerChannel {
  id: string;
  name: string;
  userId: string | null;
  status: string;
}

/** GET the connected WeChat channels for the notification form. */
export async function fetchWechatChannels(): Promise<SchedulerChannel[]> {
  const res = await fetch("/api/channels?provider=wechat", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { channels?: SchedulerChannel[] };
  return data.channels ?? [];
}
