/**
 * Kanban panel data hook.
 *
 * Loads the full board (GET /api/kanban), polls it every few seconds so
 * running cards flip to review_test live, and exposes the mutations the
 * panel calls (create / start / move / edit / delete). All mutations return
 * a boolean so the UI can toast its own errors.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateKanbanTaskInput,
  KanbanTask,
  UpdateKanbanTaskInput,
} from "@/lib/shared/kanban-types";

const POLL_MS = 5000;

interface KanbanApiError {
  error?: string;
  field?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & KanbanApiError;
  if (!res.ok) {
    throw new Error(data.error ?? `request failed (${res.status})`);
  }
  return data;
}

export interface UseKanban {
  tasks: KanbanTask[] | null;
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input: CreateKanbanTaskInput) => Promise<KanbanTask | null>;
  start: (id: string) => Promise<boolean>;
  stop: (id: string) => Promise<boolean>;
  move: (id: string, patch: UpdateKanbanTaskInput) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useKanban(): UseKanban {
  const [tasks, setTasks] = useState<KanbanTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await request<{ tasks: KanbanTask[] }>("/api/kanban", {
        cache: "no-store",
      });
      if (mounted.current) setTasks(data.tasks);
    } catch {
      // Keep last known board on transient failures.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const create = useCallback(
    async (input: CreateKanbanTaskInput): Promise<KanbanTask | null> => {
      try {
        const data = await request<{ task: KanbanTask }>("/api/kanban", {
          method: "POST",
          body: JSON.stringify(input),
        });
        await refresh();
        return data.task;
      } catch {
        return null;
      }
    },
    [refresh],
  );

  const start = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await request(`/api/kanban/${encodeURIComponent(id)}/run`, {
          method: "POST",
        });
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const stop = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await request(`/api/kanban/${encodeURIComponent(id)}/stop`, {
          method: "POST",
        });
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const move = useCallback(
    async (id: string, patch: UpdateKanbanTaskInput): Promise<boolean> => {
      try {
        await request<{ task: KanbanTask }>(
          `/api/kanban/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify(patch) },
        );
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await request(`/api/kanban/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  return { tasks, loading, refresh, create, start, stop, move, remove };
}