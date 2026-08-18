"use client";

import { useCallback, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  getSessionTabTitle,
  type SessionTab,
  type SessionTabStatus,
} from "@/hooks/sessionWorkspaceStore";
import { Tooltip } from "./Tooltip";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";

interface Props {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewSession?: () => void;
  onBatchClose?: (tabId: string, mode: "left" | "right" | "others") => void;
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
  return (
    <span
      aria-hidden
      style={{
        width: status === "completed" ? 6 : 7,
        height: status === "completed" ? 6 : 7,
        borderRadius: "50%",
        flexShrink: 0,
        background: status === "running"
          ? "var(--accent)"
          : status === "error"
            ? "#ef4444"
            : "#22c55e",
        boxShadow: status === "running" ? "0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
        animation: status === "running" ? "scheduler-running-pulse 1.6s ease-in-out infinite" : undefined,
      }}
    />
  );
}

export function SessionTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewSession, onBatchClose, leadingControl }: Props) {
  const { t } = useI18n();
  const cm = useContextMenu();
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return;
    const next = el.scrollLeft + e.deltaX + e.deltaY;
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        minWidth: 0,
        height: 34,
        flexShrink: 0,
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {leadingControl && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", borderRight: "1px solid var(--border)" }}>
          {leadingControl}
        </div>
      )}
      <div
        onWheel={handleWheel}
        style={{
          display: "flex",
          alignItems: "stretch",
          minWidth: 0,
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
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
            onClick={() => onSelectTab(tab.tabId)}
            onContextMenu={(event) => {
              event.preventDefault();
              const index = tabs.findIndex((item) => item.tabId === tab.tabId);
              const items: ContextMenuItem[] = [
                { key: "close", label: t("Close tab"), onSelect: () => onCloseTab(tab.tabId) },
                { key: "close-left", label: t("Close tabs to the left"), onSelect: () => onBatchClose?.(tab.tabId, "left"), disabled: index === 0 },
                { key: "close-right", label: t("Close tabs to the right"), onSelect: () => onBatchClose?.(tab.tabId, "right"), disabled: index === tabs.length - 1 },
                { key: "close-others", label: t("Close other tabs"), onSelect: () => onBatchClose?.(tab.tabId, "others"), disabled: tabs.length <= 1 },
              ];
              cm.open({ x: event.clientX, y: event.clientY, items });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 96,
              maxWidth: 180,
              height: 34,
              padding: "0 6px 0 12px",
              flexShrink: 0,
              cursor: "pointer",
              userSelect: "none",
              color: active ? "var(--text)" : "var(--text-muted)",
              background: active ? "var(--bg-selected)" : "transparent",
              boxShadow: active ? "inset 0 -2px 0 var(--accent)" : "none",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            <StatusMark status={tab.status} />
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
                  fontSize: 12,
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
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.tabId);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  padding: 0,
                  flexShrink: 0,
                  border: "none",
                  borderRadius: 4,
                  color: "var(--text-dim)",
                  background: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.color = "var(--text)";
                  event.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.color = "var(--text-dim)";
                  event.currentTarget.style.background = "transparent";
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
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
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 34,
              flexShrink: 0,
              padding: 0,
              border: "none",
              borderLeft: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </Tooltip>
      )}
      </div>
    </div>
  );
}
