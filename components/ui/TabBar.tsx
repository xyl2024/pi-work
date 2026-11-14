"use client";

import { useCallback, useRef } from "react";
import { getFileIcon } from "@/components/ui/icons";
import { ICONS } from "@/components/ui/icons";
import { PANEL_TAB_ICON_BY_KIND } from "@/components/panels/right-bar/desc";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";
import styles from "./TabBar.module.css";
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
      className={styles.strip}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const displayLabel = tab.kind === "file" ? tab.label ?? "" : t(tab.labelKey);
        const tooltipContent = tab.kind === "file" ? tab.params.path : displayLabel;
        const icon =
          tab.kind === "file"
            ? getFileIcon(tab.label ?? "", 13)
            : PANEL_TAB_ICON_BY_KIND[tab.kind]({ size: 13, active: isActive });
        return (
          <div
            key={tab.id}
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
            className={[styles.tab, isActive ? styles.tabActive : ""].filter(Boolean).join(" ")}
          >
            <span className={styles.icon}>{icon}</span>
            <Tooltip content={tooltipContent}>
              <span className={styles.label}>{displayLabel}</span>
            </Tooltip>
            <Tooltip content={t("Close")}>
              <button
                type="button"
                aria-label={`${t("Close")} ${displayLabel}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={styles.close}
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
