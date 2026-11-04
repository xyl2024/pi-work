"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { schedulerPanel, useSchedulerPanel } from "@/lib/client/scheduler-panel";
import { SchedulerRootPage } from "./scheduler/SchedulerRootPage";
import { SchedulerDetailPage } from "./scheduler/SchedulerDetailPage";
import { SchedulerFormPage } from "./scheduler/SchedulerFormPage";

export function SchedulerPanel({
  cwd,
  onOpenSession,
  onExit,
  visible = true,
}: {
  cwd: string | null;
  onOpenSession: (sessionId: string) => void;
  onExit?: () => void;
  visible?: boolean;
}) {
  useSchedulerPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    schedulerPanel.open();
  }, []);

  const page = schedulerPanel.currentPage();

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page, visible]);

  usePanelEscapeGuard(containerRef, () => {
    if (schedulerPanel.back().closePanel) onExit?.();
  }, visible);

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
