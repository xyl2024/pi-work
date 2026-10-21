"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import {
  nextProcessFold,
  processFoldActions,
  processFoldWindow,
  summarizeFoldWindow,
  type ProcessFoldEvent,
  type ProcessFoldState,
} from "@/lib/shared/process-fold";
import { Tooltip } from "../../ui/Tooltip";
import { useCollapseNonce } from "../message-view/context";
import { useProcessFoldMotion } from "./hooks/useProcessFoldMotion";

const MAX_TOOL_BREAKDOWN = 3;

/** One process row the fold can show. ChatWindow owns what a row is (its node
 *  and its own tool calls); this component owns which slice is on screen. */
export interface ProcessDetailsItem {
  key: string;
  node: React.ReactNode;
  toolCalls: Record<string, number>;
}

export function ProcessDetailsGroup({ items }: { items: ProcessDetailsItem[] }) {
  const { t, locale } = useI18n();
  const total = items.length;
  const [fold, setFold] = useState<ProcessFoldState>({ kind: "collapsed" });
  const collapseNonce = useCollapseNonce();
  const rootRef = useRef<HTMLDivElement>(null);
  const { contentRef, contentHeight } = useCollapseHeight<HTMLDivElement>();
  const { motion, beginTransition } = useProcessFoldMotion({
    rootRef,
    contentRef,
    state: fold,
    total,
  });

  const applyFoldEvent = useCallback(
    (event: ProcessFoldEvent) => {
      const next = nextProcessFold(fold, event, total);
      if (next === fold) return;
      beginTransition(fold, next);
      setFold(next);
    },
    [beginTransition, fold, total],
  );

  // The global "collapse all" broadcast zeroes this fold. It does not reset
  // per-block expand state itself: the blocks unmount while collapsed and
  // remount in their default state (the feature spec accepts that trade-off).
  // The nonce is consumed once so a later manual expansion stays open.
  const handledCollapseNonce = useRef(0);
  useEffect(() => {
    if (collapseNonce === handledCollapseNonce.current) return;
    handledCollapseNonce.current = collapseNonce;
    const next = nextProcessFold(fold, { type: "collapse-all" }, total);
    if (next === fold) return;
    beginTransition(fold, next);
    setFold(next);
  }, [beginTransition, collapseNonce, fold, total]);

  const foldWindow = processFoldWindow(fold, total);
  const collapsed = fold.kind === "collapsed";
  const actions = processFoldActions(fold, total);
  const visibleItems = items.slice(foldWindow.start, foldWindow.end);

  const toolCallCounts = summarizeFoldWindow(items, fold);
  const toolCallCount = Object.values(toolCallCounts).reduce((sum, count) => sum + count, 0);
  const summary = foldWindow.isFraction
    ? t("{n} / {total} messages")
        .replace("{n}", String(foldWindow.shown))
        .replace("{total}", String(total))
    : t("{n} messages").replace("{n}", String(foldWindow.shown));
  const withCalls =
    toolCallCount > 0
      ? ` · ${t(toolCallCount === 1 ? "{n} tool call" : "{n} tool calls").replace("{n}", String(toolCallCount))}`
      : "";
  const toolEntries = Object.entries(toolCallCounts).sort((a, b) => b[1] - a[1]);
  const toolSummary = useMemo(() => {
    if (toolEntries.length === 0) return null;
    const separator = locale === "zh" ? "、" : ", ";
    const shown = toolEntries
      .slice(0, MAX_TOOL_BREAKDOWN)
      .map(([name, count]) => t("{n}× {tool}").replace("{n}", String(count)).replace("{tool}", name))
      .join(separator);
    const rest = toolEntries.length - Math.min(toolEntries.length, MAX_TOOL_BREAKDOWN);
    return ` · ${shown}${rest > 0 ? " …" : ""}`;
  }, [locale, t, toolEntries]);
  const toolFullList = useMemo(() => {
    if (toolEntries.length <= MAX_TOOL_BREAKDOWN) return null;
    return toolEntries
      .map(([name, count]) => t("{n}× {tool}").replace("{n}", String(count)).replace("{tool}", name))
      .join(locale === "zh" ? "、" : ", ");
  }, [locale, t, toolEntries]);

  const bodyHeight = collapsed
    ? 0
    : motion === "instant"
      ? "auto"
      : (contentHeight ?? "auto");

  return (
    <div ref={rootRef} style={{ marginBottom: 14 }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => applyFoldEvent({ type: "row-click" })}
        onKeyDown={(event) => {
          // Child buttons handle their own keys; only the row itself toggles.
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          applyFoldEvent({ type: "row-click" });
        }}
        className="process-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: collapsed ? "none" : "rotate(90deg)",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {summary}
          {withCalls}
          {toolSummary && (toolFullList ? (
            <Tooltip content={toolFullList}>
              <span>{toolSummary}</span>
            </Tooltip>
          ) : (
            toolSummary
          ))}
        </span>
        {actions.length > 0 && (
          <span
            className="process-fold-actions"
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            {actions.map((action) => {
              const label =
                action.type === "reveal-all"
                  ? t("Expand all")
                  : action.revealsRest
                    ? t("Expand remaining {n}").replace("{n}", String(action.count))
                    : collapsed
                      ? t("Expand last {n}").replace("{n}", String(action.count))
                      : t("Expand next {n}").replace("{n}", String(action.count));
              return (
                <button
                  key={action.type}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    applyFoldEvent({ type: action.type });
                  }}
                  style={{
                    flexShrink: 0,
                    padding: "1px 6px",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    background: "var(--bg-panel)",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    lineHeight: "16px",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </span>
        )}
      </div>
      <div
        style={{
          height: bodyHeight,
          overflow: "hidden",
          // Our prepend compensation is explicit; browser scroll anchoring must
          // not also move the viewport or the two would cancel each other out.
          overflowAnchor: "none",
          transition: motion === "animate" ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
        }}
      >
        <div ref={contentRef} style={{ overflow: "hidden" }}>
          {!collapsed && (
            <div style={{ marginTop: 8 }}>
              {visibleItems.map((item) => (
                <Fragment key={item.key}>{item.node}</Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
