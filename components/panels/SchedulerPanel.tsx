"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentSchedulerPage } from "@/lib/shared/scheduler-pages";
import {
  escapeScheduler,
  reloadSchedulerTasks,
  useSchedulerStore,
} from "@/lib/client/scheduler-store";
import { SchedulerRootPage } from "./scheduler/SchedulerRootPage";
import { SchedulerDetailPage } from "./scheduler/SchedulerDetailPage";
import { SchedulerFormPage } from "./scheduler/SchedulerFormPage";

/**
 * The 定时任务 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component owns no
 * page state: the list, the selection, the filters, the page stack and the form
 * draft all live in `lib/client/scheduler-store.ts`. Here it wires the re-read
 * on entry, dispatches the current page to a full-width view, and turns Escape
 * into "up one level" — falling back to the panel tab's close rule from the
 * task list.
 */
export function SchedulerPanel({
  cwd,
  onOpenSession,
  onCloseTab,
}: {
  cwd: string | null;
  onOpenSession: (sessionId: string) => void;
  onCloseTab?: () => void;
}) {
  const { pages } = useSchedulerStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void reloadSchedulerTasks();
  }, []);

  const page = currentSchedulerPage(pages);

  // Focus is kept inside the panel while it is the active surface, so a
  // palette / dialog that has taken focus keeps its own Escape.
  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (escapeScheduler().closePanel) onCloseTab?.();
  });

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {page.kind === "detail" ? (
        // Remounting on taskId keeps the run history / block scoped to the task
        // actually on screen when one detail page replaces another.
        <SchedulerDetailPage key={page.taskId} taskId={page.taskId} onOpenSession={onOpenSession} />
      ) : page.kind === "form" ? (
        <SchedulerFormPage key={page.taskId ?? "new"} />
      ) : (
        <SchedulerRootPage cwd={cwd} />
      )}
    </div>
  );
}
