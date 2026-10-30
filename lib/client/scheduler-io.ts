"use client";

import type {
  SchedulerModelMeta,
  ScheduledTask,
  TaskCreatePayload,
  TaskRun,
  TaskUpdatePayload,
} from "@/lib/shared/scheduler";

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
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  const data = await request<{ tasks?: ScheduledTask[] }>("/api/scheduled-tasks");
  return data.tasks ?? [];
}

export async function fetchTaskRuns(taskId: string): Promise<TaskRun[]> {
  const data = await request<{ runs?: TaskRun[] }>(
    `/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs`,
  );
  return data.runs ?? [];
}

export async function triggerScheduledTask(taskId: string): Promise<void> {
  await request(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/run`, { method: "POST" });
}

export async function patchScheduledTask(taskId: string, enabled: boolean): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "PATCH",
    body: JSON.stringify({ id: taskId, enabled }),
  });
  return data.task;
}

export async function createScheduledTask(payload: TaskCreatePayload): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.task;
}

export async function updateScheduledTask(payload: TaskUpdatePayload): Promise<ScheduledTask> {
  const data = await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.task;
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  await request(`/api/scheduled-tasks?id=${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

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

export interface SchedulerChannel {
  id: string;
  name: string;
  userId: string | null;
  status: string;
}

export async function fetchWechatChannels(): Promise<SchedulerChannel[]> {
  const res = await fetch("/api/channels?provider=wechat", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { channels?: SchedulerChannel[] };
  return data.channels ?? [];
}
