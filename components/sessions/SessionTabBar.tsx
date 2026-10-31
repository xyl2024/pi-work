"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  getSessionTabTitle,
  type SessionTab,
  type SessionTabStatus,
} from "@/hooks/sessionWorkspaceStore";
import { Tooltip } from "../ui/Tooltip";
import { SessionPermissionBadge } from "../ui/SessionPermissionBadge";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { InlineLoader } from "generative-loaders";
import { createEdgeAutoscroll } from "@/lib/client/tab-bar-autoscroll";

const DRAG_END_SUPPRESS_MS = 500;

interface Props {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewSession?: () => void;
  onBatchClose?: (tabId: string, mode: "left" | "right" | "others") => void;
  onReload?: (tabId: string) => void;
  onReorder?: (tabId: string, toIndex: number) => void;
  leadingControl?: ReactNode;
}

function statusLabel(status: SessionTabStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "running") return t("running");
  if (status === "completed") return t("Background complete");
  if (status === "error") return t("Error");
  return "";
}

function StatusMark({ status }: { status: SessionTabStatus }) {
  if (status === "idle") return null;
  if (status === "running") {
    return (
      <span
        aria-hidden
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <InlineLoader variant="orbit" size={14} color="var(--accent)" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        flexShrink: 0,
        background: status === "error" ? "#ef4444" : "#22c55e",
      }}
    />
  );
}

export function SessionTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewSession, onBatchClose, onReload, onReorder, leadingControl }: Props) {
  const { t } = useI18n();
  const cm = useContextMenu();
  const dragTabIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragEndedAtRef = useRef(0);
  const closeArmedRef = useRef<string | null>(null);
  const [closeArmedId, setCloseArmedId] = useState<string | null>(null);
  const autoscrollRef = useRef<ReturnType<typeof createEdgeAutoscroll> | null>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);
  const getAutoscroll = useCallback(() => {
    if (!autoscrollRef.current) autoscrollRef.current = createEdgeAutoscroll();
    return autoscrollRef.current;
  }, []);
  const computeDropPoint = useCallback((clientX: number): { index: number; x: number | null } | null => {
    const draggedId = dragTabIdRef.current;
    if (!draggedId) return null;
    const container = scrollRef.current;
    if (!container) return null;
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>("[data-session-tab-id]"),
    ).filter((node) => node.dataset.sessionTabId !== draggedId);
    let index = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (clientX >= rect.left + rect.width / 2) index += 1;
    }
    const containerRect = container.getBoundingClientRect();
    let x: number | null = null;
    if (nodes.length > 0) {
      const anchorRect =
        index < nodes.length ? nodes[index].getBoundingClientRect() : nodes[nodes.length - 1].getBoundingClientRect();
      const anchor = index < nodes.length ? anchorRect.left : anchorRect.right;
      x = anchor - containerRect.left + container.scrollLeft;
    }
    return { index, x };
  }, []);
  const clearDropTarget = useCallback(() => {
    dropIndexRef.current = null;
    setIndicatorX(null);
  }, []);
  const resetDrag = useCallback(() => {
    dragTabIdRef.current = null;
    clearDropTarget();
    getAutoscroll().stop();
  }, [clearDropTarget, getAutoscroll]);
  const releaseCloseGuard = useCallback(() => {
    if (closeArmedRef.current === null) return;
    closeArmedRef.current = null;
    setCloseArmedId(null);
    window.removeEventListener("pointerup", releaseCloseGuard);
  }, []);
  const armCloseGuard = useCallback((tabId: string) => {
    releaseCloseGuard();
    closeArmedRef.current = tabId;
    setCloseArmedId(tabId);
    window.addEventListener("pointerup", releaseCloseGuard);
  }, [releaseCloseGuard]);
  useEffect(() => releaseCloseGuard, [releaseCloseGuard]);
  const isNoDropTarget = (event: { target: EventTarget | null }): boolean =>
    event.target instanceof Element && event.target.closest("[data-no-drop]") !== null;
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;

    const lineHeight = 16;
    const page = Math.max(el.clientWidth, 200);
    const normalize = (raw: number) => {
      if (e.deltaMode === 1) return raw * lineHeight;
      if (e.deltaMode === 2) return raw * page;
      return raw;
    };
    const dx = normalize(e.deltaX);
    const dy = normalize(e.deltaY);
    const next = el.scrollLeft + dy + dx;
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        height: 34,
        flexShrink: 0,
        background: "transparent",
        borderRadius: "var(--panel-radius) var(--panel-radius) 0 0",
        overflow: "hidden",
        padding: "0 6px",
        gap: 2,
      }}
    >
      {leadingControl && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch" }}>
          {leadingControl}
        </div>
      )}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        data-hide-v-scrollbar
        onDragOver={(event) => {
          if (!dragTabIdRef.current) return;
          if (isNoDropTarget(event)) {
            clearDropTarget();
            return;
          }
          event.preventDefault();
          const point = computeDropPoint(event.clientX);
          if (!point) return;
          dropIndexRef.current = point.index;
          setIndicatorX(point.x);
          getAutoscroll().update(event.clientX);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const draggedId = dragTabIdRef.current;
          const dropIndex = dropIndexRef.current ?? computeDropPoint(event.clientX)?.index ?? null;
          resetDrag();
          if (draggedId && dropIndex !== null && !isNoDropTarget(event)) onReorder?.(draggedId, dropIndex);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearDropTarget();
            getAutoscroll().outside();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          background: "transparent",
          overflowX: "auto",
          height: 34,
          gap: 2,
          position: "relative",
        }}
      >
        {indicatorX !== null && dragTabIdRef.current !== null && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              left: 0,
              width: 2,
              borderRadius: 1,
              background: "var(--accent)",
              transform: `translateX(${indicatorX - 1}px)`,
              pointerEvents: "none",
            }}
          />
        )}
        {tabs.map((tab) => {
        const active = tab.tabId === activeTabId;
        const title = tab.kind === "draft" ? t("New session") : getSessionTabTitle(tab.session!);
        const tooltip = tab.kind === "draft"
          ? (tab.cwd ? `${t("New session")} · ${tab.cwd}` : t("New session"))
          : title;
        const stateText = statusLabel(tab.status, t);
        return (
          <div
            key={tab.tabId}
            className="group/tab"
            data-session-tab-id={tab.tabId}
            draggable={closeArmedId !== tab.tabId}
            onDragStart={(event) => {
              if (event.target instanceof Element && event.target.closest("[data-no-drag]")) {
                event.preventDefault();
                return;
              }
              dragTabIdRef.current = tab.tabId;
              clearDropTarget();
              const scroller = scrollRef.current;
              if (scroller) getAutoscroll().start(scroller);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.tabId);
            }}
            onDragEnd={() => {
              dragEndedAtRef.current = Date.now();
              resetDrag();
            }}
            onClick={() => {
              if (Date.now() - dragEndedAtRef.current < DRAG_END_SUPPRESS_MS) return;
              onSelectTab(tab.tabId);
            }}
            onDoubleClick={(event) => {
              if (Date.now() - dragEndedAtRef.current < DRAG_END_SUPPRESS_MS) return;
              event.stopPropagation();
              onCloseTab(tab.tabId);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const index = tabs.findIndex((item) => item.tabId === tab.tabId);
              const items: ContextMenuItem[] = [
                { key: "reload", label: t("Refresh"), onSelect: () => onReload?.(tab.tabId), disabled: tab.kind === "draft" || !onReload },
                { key: "close", label: t("Close tab"), onSelect: () => onCloseTab(tab.tabId), separatorBefore: true },
                { key: "close-left", label: t("Close tabs to the left"), onSelect: () => onBatchClose?.(tab.tabId, "left"), disabled: index === 0 },
                { key: "close-right", label: t("Close tabs to the right"), onSelect: () => onBatchClose?.(tab.tabId, "right"), disabled: index === tabs.length - 1 },
                { key: "close-others", label: t("Close other tabs"), onSelect: () => onBatchClose?.(tab.tabId, "others"), disabled: tabs.length <= 1 },
              ];
              cm.open({ x: event.clientX, y: event.clientY, items, triggerElement: event.currentTarget as HTMLElement });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              height: 24,
              padding: "0 4px 0 8px",
              background: active ? "var(--bg-selected)" : "transparent",
              cursor: "pointer",
              fontSize: 12,
              color: active ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 200,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
              borderRadius: 4,
            }}
          >
            <StatusMark status={tab.status} />
            <SessionPermissionBadge
              sessionId={tab.sessionId}
              fallbackMode={tab.session?.permissionMode}
              fallbackBackground={tab.session?.background}
            />
            {tab.dirty && (
              <Tooltip content={t("Unsaved draft")}>
                <span
                  aria-label={t("Unsaved draft")}
                  style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Tooltip content={stateText ? `${tooltip} · ${stateText}` : tooltip}>
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {title}
              </span>
            </Tooltip>
            <Tooltip content={t("Close tab")}>
              <button
                type="button"
                aria-label={`${t("Close tab")} ${title}`}
                draggable={false}
                data-no-drag
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  armCloseGuard(tab.tabId);
                }}
                className="pointer-events-none opacity-0 transition-opacity group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.tabId);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  padding: 0,
                  flexShrink: 0,
                  border: "none",
                  background: "transparent",
                  borderRadius: 3,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </Tooltip>
          </div>
        );
        })}
        {onNewSession && (
          <Tooltip content={t("New session")}>
          <button
            type="button"
            aria-label={t("New session")}
            onClick={onNewSession}
            data-no-drag
            data-no-drop
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              flexShrink: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            +
          </button>
        </Tooltip>
        )}
      </div>
    </div>
  );
}
