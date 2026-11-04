"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { requestSchedulerLeave, schedulerPanel, useSchedulerPanel } from "@/lib/client/scheduler-panel";
import { SchedulerTaskList } from "./scheduler/SchedulerTaskList";
import { SchedulerDetailPage } from "./scheduler/SchedulerDetailPage";
import { SchedulerFormPage } from "./scheduler/SchedulerFormPage";
import { SchedulerCreateGuide, SchedulerSelectHint } from "./scheduler/SchedulerEmptyStates";

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
  const { view } = useSchedulerPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    schedulerPanel.open();
  }, []);

  const page = schedulerPanel.currentPage();
  const { loaded, tasks, selectedTaskId } = view;

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page, selectedTaskId, visible]);

  usePanelEscapeGuard(
    containerRef,
    () => {
      if (page.kind === "form") {
        void requestSchedulerLeave("back_to_browse");
        return;
      }
      if (selectedTaskId !== null) {
        schedulerPanel.patch({ selectedTaskId: null, selectedRunId: null, runsVisible: false });
        return;
      }
      onExit?.();
    },
    visible,
  );

  if (page.kind === "form") {
    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
      >
        <SchedulerFormPage key={page.taskId ?? "new"} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", minHeight: 0, outline: "none" }}
    >
      <div
        style={{
          width: 300,
          flexShrink: 0,
          minHeight: 0,
          minWidth: 0,
          borderRight: "1px solid var(--border)",
        }}
      >
        <SchedulerTaskList cwd={cwd} />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {loaded && tasks.length === 0 ? (
          <SchedulerCreateGuide cwd={cwd} />
        ) : selectedTaskId === null ? (
          <SchedulerSelectHint />
        ) : (
          <SchedulerDetailPage key={selectedTaskId} taskId={selectedTaskId} onOpenSession={onOpenSession} />
        )}
      </div>
    </div>
  );
}
