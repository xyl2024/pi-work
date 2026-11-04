"use client";

import { useEffect, useCallback, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import {
  clearSchedulerSelection,
  schedulerPanel,
  useSchedulerPanel,
} from "@/lib/client/scheduler-panel";
import { requestMainViewLeave } from "@/lib/client/main-view-leave";
import { MainViewMasterDetail } from "./MainViewMasterDetail";
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

  const formTitleKey = page.kind === "form" ? (page.taskId === null ? "New task" : "Edit task") : null;
  const backToBrowse = useCallback(() => {
    void requestMainViewLeave({ view: "scheduler", intent: "back_to_browse" });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page, selectedTaskId, visible, containerRef]);

  usePanelEscapeGuard(
    containerRef,
    () => {
      if (page.kind === "form") {
        void requestMainViewLeave({ view: "scheduler", intent: "back_to_browse" });
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
    <MainViewMasterDetail
      containerRef={containerRef}
      titleKey={formTitleKey}
      onBack={page.kind === "form" ? backToBrowse : null}
      full={page.kind === "form" ? <SchedulerFormPage key={page.taskId ?? "new"} /> : null}
      list={<SchedulerTaskList cwd={cwd} />}
      detail={renderDetail}
      hasDetail={selectedTaskId !== null}
      onClearDetail={clearSchedulerSelection}
    />
  );
}
