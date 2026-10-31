"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { escapeScheduler, schedulerPanel, useSchedulerPanel } from "@/lib/client/scheduler-panel";
import { SchedulerRootPage } from "./scheduler/SchedulerRootPage";
import { SchedulerDetailPage } from "./scheduler/SchedulerDetailPage";
import { SchedulerFormPage } from "./scheduler/SchedulerFormPage";

export function SchedulerPanel({
  cwd,
  onOpenSession,
  onCloseTab,
}: {
  cwd: string | null;
  onOpenSession: (sessionId: string) => void;
  onCloseTab?: () => void;
}) {
  useSchedulerPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    schedulerPanel.open();
  }, []);

  const page = schedulerPanel.currentPage();

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
        <SchedulerDetailPage key={page.taskId} taskId={page.taskId} onOpenSession={onOpenSession} />
      ) : page.kind === "form" ? (
        <SchedulerFormPage key={page.taskId ?? "new"} />
      ) : (
        <SchedulerRootPage cwd={cwd} />
      )}
    </div>
  );
}
