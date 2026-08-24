"use client";

import { useCallback, useRef } from "react";
import { getFileIcon } from "@/components/ui/icons";
import { ICONS } from "@/components/ui/icons";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";

export type Tab =
  | { kind: "file"; id: string; label: string; filePath: string }
  | { kind: "todo"; id: string; label: string }
  | { kind: "favorites"; id: string; label: string }
  | { kind: "translate"; id: string; label: string }
  | { kind: "toolCalls"; id: string; label: string }
  | { kind: "json"; id: string; label: string }
  | { kind: "canvas"; id: string; label: string }
  | { kind: "rss"; id: string; label: string }
  | { kind: "tokens"; id: string; label: string }
  | { kind: "gitDiff"; id: string; label: string }
  | { kind: "conversationTree"; id: string; label: string }
  | { kind: "llmAudit"; id: string; label: string }
  | { kind: "context"; id: string; label: string };

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContextMenu?: (tabId: string, x: number, y: number) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onContextMenu }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Convert vertical wheel (deltaY) into horizontal scroll, matching the
  // VSCode tab-bar behavior. We also fold deltaX in so that macOS trackpad
  // horizontal gestures (which arrive as plain deltaX) keep working.
  //
  // deltaMode notes:
  //   - 0 = pixels (most browsers / trackpad)
  //   - 1 = lines (Firefox mouse wheel) — convert to a ~16px-per-line estimate
  //   - 2 = pages  — treat as one screenful
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    // Only intercept when there's actually horizontal overflow to scroll into.
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
    // deltaY drives horizontal scroll (vertical wheel → horizontal).
    // deltaX is added on top so trackpad horizontal gestures still work.
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
          // Derive the displayed label at render time for the tokens tab so
          // locale switches update the open tab's name. Other tabs keep the
          // label captured at open time (existing behavior).
          const displayLabel =
            tab.kind === "tokens"
              ? t("Token audit")
              : tab.kind === "context"
                ? t("Context")
                : tab.label;
          const tooltipContent =
            tab.kind === "file" ? tab.filePath : displayLabel;
          const icon =
            tab.kind === "todo" ? (
              <ICONS.check size={13} />
            ) : tab.kind === "favorites" ? (
              <ICONS.star size={13} />
            ) : tab.kind === "translate" ? (
              <ICONS.language size={13} />
            ) : tab.kind === "toolCalls" ? (
              <ICONS.tool size={13} />
            ) : tab.kind === "json" ? (
              <ICONS.json size={13} />
            ) : tab.kind === "canvas" ? (
              <ICONS.canvas size={13} />
            ) : tab.kind === "rss" ? (
              <ICONS.rss size={13} />
            ) : tab.kind === "tokens" ? (
              <ICONS.tokens size={13} />
            ) : tab.kind === "llmAudit" ? (
              <ICONS.llmAudit size={13} />
            ) : tab.kind === "context" ? (
              getFileIcon("AGENTS.md", 13)
            ) : tab.kind === "conversationTree" ? (
              <ICONS.conversationTree size={13} />
            ) : tab.kind === "gitDiff" ? (
              <ICONS.gitDiff size={13} />
            ) : (
              getFileIcon(tab.label, 13)
            );
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
                onContextMenu?.(tab.id, e.clientX, e.clientY);
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
