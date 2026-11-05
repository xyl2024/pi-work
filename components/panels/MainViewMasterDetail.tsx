"use client";

import { useEffect, type ReactNode, type RefObject } from "react";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { useInjectMainViewHeader } from "@/lib/client/main-view-header";
import { resolveSchedulerLayout, SCHEDULER_LIST_WIDTH } from "@/lib/shared/scheduler-layout";

export interface MainViewMasterDetailProps {
  containerRef: RefObject<HTMLDivElement | null>;
  titleKey: string | null;
  onBack: (() => void) | null;
  full?: ReactNode;
  list: ReactNode;
  detail: (onBack?: () => void) => ReactNode;
  hasDetail: boolean;
  onClearDetail: () => void;
  onExit?: () => void;
  visible?: boolean;
  focusKey?: string | null;
}

export function MainViewMasterDetail({
  containerRef,
  titleKey,
  onBack,
  full,
  list,
  detail,
  hasDetail,
  onClearDetail,
  onExit,
  visible = true,
  focusKey = null,
}: MainViewMasterDetailProps) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(containerRef);
  const layout = resolveSchedulerLayout(width);
  useInjectMainViewHeader(titleKey, onBack);

  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [focusKey, visible, ref]);

  usePanelEscapeGuard(
    containerRef,
    () => {
      if (full != null) {
        onBack?.();
        return;
      }
      if (hasDetail) {
        onClearDetail();
        return;
      }
      onExit?.();
    },
    visible,
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {full != null ? (
        full
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
            {list}
          </div>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{detail()}</div>
        </div>
      ) : hasDetail ? (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{detail(onClearDetail)}</div>
      ) : (
        list
      )}
    </div>
  );
}
