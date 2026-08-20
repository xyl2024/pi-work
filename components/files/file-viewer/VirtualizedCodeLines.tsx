"use client";

import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { type GitDeletedBlock, type GitLineMarkType } from "@/lib/shared/git-line-marks";
import {
  CODE_LINE_HEIGHT,
  CODE_TOP_PADDING,
  GIT_ADDED_COLOR,
  GIT_DELETED_COLOR,
  GIT_MODIFIED_COLOR,
} from "./utils";

interface VirtualizedCodeLinesProps {
  lines: string[];
  gitMarks: Map<number, GitLineMarkType> | null;
  gitDeletedBlocks: GitDeletedBlock[];
  expandedDelete: number | null;
  onToggleDelete: (index: number) => void;
  matchedLines: ReadonlySet<number>;
  currentMatchLine: number | null;
}

/**
 * Windowed renderer for very large text files (see VIRTUALIZE_MIN_LINES /
 * VIRTUALIZE_MIN_BYTES). Only the lines intersecting the viewport plus an
 * overscan band are mounted; every row is absolutely positioned inside a
 * full-height spacer so the scrollbar still reflects the whole file. Syntax
 * highlighting is intentionally dropped (tokenizing a multi-MB file on the
 * main thread is the other half of the original stall), but line numbers,
 * search-match highlights, and git gutter marks are preserved.
 */
export function VirtualizedCodeLines({
  lines,
  gitMarks,
  gitDeletedBlocks,
  expandedDelete,
  onToggleDelete,
  matchedLines,
  currentMatchLine,
}: VirtualizedCodeLinesProps) {
  const { t } = useI18n();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep viewport height in sync with the container (panel resize, etc.).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const total = lines.length;
  // Overscan band above/below the viewport so fast scrolling doesn't flash
  // empty space while React catches up.
  const OVERSCAN = 30;
  const start = Math.max(0, Math.floor(scrollTop / CODE_LINE_HEIGHT) - OVERSCAN);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + Math.max(viewportH, 1)) / CODE_LINE_HEIGHT) + OVERSCAN,
  );

  const rows: React.ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const lineNo = i + 1;
    const mark = gitMarks?.get(lineNo);
    const isCurrent = lineNo === currentMatchLine;
    const isMatch = !isCurrent && matchedLines.has(lineNo);
    const style: React.CSSProperties = {};
    if (mark === "added") style.borderLeft = `3px solid ${GIT_ADDED_COLOR}`;
    else if (mark === "modified") style.borderLeft = `3px solid ${GIT_MODIFIED_COLOR}`;
    if (isCurrent) style.background = "rgba(255, 200, 0, 0.30)";
    else if (isMatch) style.background = "rgba(255, 200, 0, 0.12)";
    rows.push(
      <div
        key={lineNo}
        data-fv-line={lineNo}
        style={{
          position: "absolute",
          top: CODE_TOP_PADDING + i * CODE_LINE_HEIGHT,
          left: 0,
          right: 0,
          height: CODE_LINE_HEIGHT,
          display: "flex",
          ...style,
        }}
      >
        <span
          style={{
            minWidth: "3em",
            paddingRight: "1em",
            textAlign: "right",
            color: "var(--text-dim)",
            userSelect: "none",
            flexShrink: 0,
          }}
        >
          {lineNo}
        </span>
        <span
          style={{
            flex: 1,
            whiteSpace: "pre",
            padding: "0 8px 0 0",
            color: "var(--text)",
            tabSize: 4,
          }}
        >
          {lines[i] || "\u00a0"}
        </span>
      </div>,
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="fv-virtual-scroll"
      style={{ height: "100%", overflow: "auto", background: "var(--bg)" }}
    >
      <div
        style={{
          position: "relative",
          height: CODE_TOP_PADDING + total * CODE_LINE_HEIGHT,
          minWidth: "100%",
        }}
      >
        {rows}
        {gitDeletedBlocks.map((block, i) => {
          const top = CODE_TOP_PADDING + (block.beforeLine - 1) * CODE_LINE_HEIGHT;
          const expanded = expandedDelete === i;
          return (
            <div key={`del-${i}`} style={{ position: "absolute", left: 0, top, width: 48, zIndex: 5 }}>
              <button
                onClick={() => onToggleDelete(i)}
                title={t("Deleted lines")}
                style={{
                  width: 44,
                  height: CODE_LINE_HEIGHT,
                  marginLeft: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#3d2020",
                  color: GIT_DELETED_COLOR,
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid rgba(248, 113, 113, 0.4)",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
              >
                −{block.lines.length}
              </button>
              {expanded && (
                <div
                  style={{
                    position: "absolute",
                    left: 3,
                    top: CODE_LINE_HEIGHT + 2,
                    width: 440,
                    maxHeight: 240,
                    overflow: "auto",
                    zIndex: 20,
                    pointerEvents: "auto",
                    background: "#3d2020",
                    border: "1px solid rgba(248, 113, 113, 0.45)",
                    borderLeft: `3px solid ${GIT_DELETED_COLOR}`,
                    borderRadius: 4,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    lineHeight: 1.6,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                  }}
                >
                  {block.lines.map((l, j) => (
                    <div
                      key={j}
                      style={{ whiteSpace: "pre", color: "#f87171", padding: "0 8px", background: "transparent" }}
                    >
                      - {l}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
