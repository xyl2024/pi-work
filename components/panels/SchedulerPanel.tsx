"use client";

import { useEffect } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import {
  clearSchedulerSelection,
  requestSchedulerLeave,
  schedulerPanel,
  useSchedulerPanel,
} from "@/lib/client/scheduler-panel";
import { resolveSchedulerLayout, SCHEDULER_LIST_WIDTH } from "@/lib/shared/scheduler-layout";
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
  const { ref: containerRef, width } = useContainerWidth<HTMLDivElement>();

  useEffect(() => {
    schedulerPanel.open();
  }, []);

  const page = schedulerPanel.currentPage();
  const { loaded, tasks, selectedTaskId } = view;
  const layout = resolveSchedulerLayout(width);

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page, selectedTaskId, visible, containerRef]);

  usePanelEscapeGuard(
    containerRef,
    () => {
      if (page.kind === "form") {
        void requestSchedulerLeave("back_to_browse");
        return;
      }
      if (selectedTaskId !== null) {
        clearSchedulerSelection();
        return;
      }
      onExit?.();
    },
    visible,
  );

  const renderDetail = (onBack?: () => void) =>
    loaded && tasks.length === 0 ? (
      <SchedulerCreateGuide cwd={cwd} />
    ) : selectedTaskId === null ? (
      <SchedulerSelectHint />
    ) : (
      <SchedulerDetailPage
        key={selectedTaskId}
        taskId={selectedTaskId}
        onOpenSession={onOpenSession}
        onBack={onBack}
      />
    );

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {page.kind === "form" ? (
        <SchedulerFormPage key={page.taskId ?? "new"} />
      ) : layout === "split" ? (
        <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
          <div
            style={{
              width: SCHEDULER_LIST_WIDTH,
              flexShrink: 0,
              minHeight: 0,
              minWidth: 0,
              borderRight: "1px solid var(--border)",
            }}
          >
            <SchedulerTaskList cwd={cwd} />
          </div>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{renderDetail()}</div>
        </div>
      ) : selectedTaskId === null ? (
        <SchedulerTaskList cwd={cwd} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{renderDetail(clearSchedulerSelection)}</div>
      )}
    </div>
  );
}
