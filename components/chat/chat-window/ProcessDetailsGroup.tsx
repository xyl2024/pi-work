"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import { Tooltip } from "../../ui/Tooltip";
import { useCollapseNonce } from "../message-view/context";

const MAX_TOOL_BREAKDOWN = 3;

export function ProcessDetailsGroup({
  messageCount,
  toolCallCounts,
  children,
}: {
  messageCount: number;
  toolCallCounts: Record<string, number>;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const collapseNonce = useCollapseNonce();
  useEffect(() => {
    if (collapseNonce > 0) setExpanded(false);
  }, [collapseNonce]);
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();

  const toolCallCount = Object.values(toolCallCounts).reduce((sum, count) => sum + count, 0);
  const summary = t("{n} messages").replace("{n}", String(messageCount));
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

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="process-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
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
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      </button>
      <div style={{ height: contentHeight ?? "auto", overflow: "hidden", transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none" }}>
        <div ref={contentRef} style={{ overflow: "hidden" }}>
          {expanded && <div style={{ marginTop: 8 }}>{children}</div>}
        </div>
      </div>
    </div>
  );
}
