"use client";

import { useCallback, useRef } from "react";
import { getFileIcon } from "@/components/ui/icons";
import { ICONS } from "@/components/ui/icons";
import { PANEL_TAB_ICON_BY_KIND } from "@/components/panels/right-bar/desc";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";
import type { AnyPanelTab } from "@/lib/shared/panelTabs";

interface Props {
  tabs: AnyPanelTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContextMenu?: (tabId: string, x: number, y: number, triggerElement: HTMLElement | null) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onContextMenu }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

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
      ref={scrollRef}
      onWheel={handleWheel}
      data-hide-v-scrollbar
      style={{
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        background: "transparent",
        overflowX: "auto",
        height: 34,
        gap: 2,
      }}
    >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const displayLabel = tab.kind === "file" ? tab.label ?? "" : t(tab.labelKey);
          const tooltipContent =
            tab.kind === "file" ? tab.params.path : displayLabel;
          const icon =
            tab.kind === "file"
              ? getFileIcon(tab.label ?? "", 13)
              : PANEL_TAB_ICON_BY_KIND[tab.kind]({ size: 13, active: isActive });
          return (
            <div
              key={tab.id}
              className="group/tab"
              data-tab-id={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu?.(tab.id, e.clientX, e.clientY, e.currentTarget as HTMLElement);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                height: 24,
                padding: "0 4px 0 8px",
                background: isActive ? "var(--bg-selected)" : "transparent",
                cursor: "pointer",
                fontSize: 12,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                whiteSpace: "nowrap",
                maxWidth: 200,
                flexShrink: 0,
                userSelect: "none",
                transition: "background 0.1s, color 0.1s",
                borderRadius: 4,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  opacity: isActive ? 1 : 0.7,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {icon}
              </span>
              <Tooltip content={tooltipContent}>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {displayLabel}
              </span>
              </Tooltip>
              <Tooltip content={t("Close")}>
              <button
                type="button"
                aria-label={`${t("Close")} ${displayLabel}`}
                className="pointer-events-none opacity-0 transition-opacity group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 16, height: 16,
                  background: "transparent",
                  border: "none",
                  borderRadius: 3,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                <ICONS.close size={12} />
              </button>
              </Tooltip>
            </div>
          );
        })}
    </div>
  );
}
