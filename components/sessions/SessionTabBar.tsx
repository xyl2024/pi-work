"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  getSessionTabTitle,
  type SessionTab,
  type SessionTabStatus,
} from "@/hooks/sessionWorkspaceStore";
import { Tooltip } from "../ui/Tooltip";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { SlidingTabIndicator } from "../ui/SlidingTabIndicator";
import { InlineLoader } from "generative-loaders";

interface Props {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewSession?: () => void;
  onBatchClose?: (tabId: string, mode: "left" | "right" | "others") => void;
  /** Force-remount the chat controller for this tab. No-op for draft tabs. */
  onReload?: (tabId: string) => void;
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
        <InlineLoader variant="aperture" size={14} color="var(--accent)" />
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

export function SessionTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewSession, onBatchClose, onReload, leadingControl }: Props) {
  const { t } = useI18n();
  const cm = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorContainerRef = useRef<HTMLDivElement>(null);
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
        height: 36,
        flexShrink: 0,
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {leadingControl && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", borderRight: "1px solid var(--border)" }}>
          {leadingControl}
        </div>
      )}
      <div
        ref={indicatorContainerRef}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}
      >
        <SlidingTabIndicator
          containerRef={indicatorContainerRef}
          scrollRef={scrollRef}
          activeId={activeTabId}
          getTabEl={(id) =>
            document.querySelector(
              `[data-session-tab-id="${CSS.escape(id)}"]`,
            )
          }
        />
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          style={{
            display: "flex",
            alignItems: "flex-end",
            background: "var(--bg-panel)",
            overflowX: "auto",
            flexShrink: 0,
            height: 36,
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
            data-session-tab-id={tab.tabId}
            onClick={() => onSelectTab(tab.tabId)}
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
              cm.open({ x: event.clientX, y: event.clientY, items });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              paddingLeft: 12,
              paddingRight: 6,
              background: "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: active ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "color 0.1s",
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
                  width: 16,
                  height: 16,
                  padding: 0,
                  flexShrink: 0,
                  border: "none",
                  borderRadius: 3,
                  color: "var(--text-dim)",
                  background: "transparent",
                  cursor: "pointer",
                  transition: "background 0.1s, color 0.1s",
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
              height: 36,
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
    </div>
  );
}
