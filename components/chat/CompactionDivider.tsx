"use client";

/* ─────────────────────────────────────────────────────────
 * COMPACTION DIVIDER — an inline notice that sits in the chat
 * stream where the kernel folded history into a summary.
 *
 * The JSONL `compaction` entry is not a user/assistant message,
 * so it never shows up in the message list on its own. This
 * divider fills that gap: a slim accent-tinted strip labelled
 * with the token count at the time of compaction, clickable to
 * expand the kernel's generated summary (Markdown).
 *
 * Expand/collapse animates the wrapper height the same way as
 * ThinkingBlock / ToolCallBlock (useCollapseHeight: ResizeObserver
 * measures the rendered content, CSS transitions the pixel value).
 * The header is a single quiet click target — no hover background,
 * no press scale — and the right-hand chevron mirrors ToolCallBlock:
 * a 10×10 stroke-only svg, `var(--text-dim)`, rotating 180° on
 * expand with a 0.15s transform transition.
 * ───────────────────────────────────────────────────────── */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import type { CompactionPoint } from "@/lib/shared/types";

interface Props {
  point: CompactionPoint;
}

export function CompactionDivider({ point }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tokenStr = point.tokensBefore.toLocaleString();
  // Same height-animation pattern as ThinkingBlock / ToolCallBlock:
  // ResizeObserver measures the rendered summary height, the wrapper
  // transitions that pixel value so CSS can interpolate it.
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      role="note"
      style={{
        margin: "14px 0",
        borderTop: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)",
        borderBottom: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)",
        background: "color-mix(in srgb, var(--accent) 6%, var(--bg-panel))",
        borderRadius: 6,
        padding: expanded ? "10px 14px 14px" : "7px 14px",
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? t("Collapse") : t("View summary")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <polyline points="4 14 10 14 10 20" />
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
          {t("Context compacted")}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("Compacted from {n} tokens", { n: tokenStr })}
        </span>
        {/* Right-edge chevron — same shape, color, and rotate-180° on
            expand as ToolCallBlock / ThinkingBlock. */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--text-dim)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <div
        style={{
          height: contentHeight ?? 0,
          overflow: "hidden",
          transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
        }}
      >
        <div ref={contentRef} style={{ overflow: "hidden" }}>
          {expanded && (
            <div
              style={{
                marginTop: 10,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text)",
                userSelect: "text",
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }) {
                    return <>{children}</>;
                  },
                  code({ className, children }) {
                    const raw = String(children ?? "");
                    if (className?.includes("language-") || raw.includes("\n")) {
                      return (
                        <pre
                          style={{
                            background: "var(--bg-selected)",
                            padding: "10px 12px",
                            borderRadius: 6,
                            overflow: "auto",
                            fontFamily: "var(--font-mono)",
                            fontSize: 12,
                            lineHeight: 1.5,
                          }}
                        >
                          <code className={className}>{children}</code>
                        </pre>
                      );
                    }
                    return (
                      <code
                        style={{
                          background: "var(--bg-selected)",
                          padding: "1px 4px",
                          borderRadius: 3,
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.9em",
                          color: "var(--accent)",
                        }}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {point.summary}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
