"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import { Tooltip } from "../Tooltip";
import { openSessionLibrary } from "@/hooks/sessionLibraryStore";
import { isShowFileToolName } from "@/lib/show-file-tool-types";
import { useShowFileResults } from "@/hooks/showFileResultsStore";
import { useMarkdownComponents, highlightTextAsHtml, getToolPreview } from "./utils";
import { useCollapseNonce } from "./context";
import type { AssistantContentBlock, TextContent, ToolCallContent, ThinkingContent, ToolResultMessage } from "@/lib/types";

export function BlockView({ block, toolResults, isStreaming, isLast, keywords, isSearchMatch, onImageClick }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; isLast?: boolean; keywords?: string[]; isSearchMatch?: boolean; onImageClick?: (src: string) => void }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} keywords={keywords} isSearchMatch={isSearchMatch} isStreaming={isStreaming} onImageClick={onImageClick} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} keywords={keywords} isSearchMatch={isSearchMatch} isStreaming={isLast && isStreaming} onImageClick={onImageClick} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} />;
  }
  return null;
}

function TextBlock({ block, keywords, isSearchMatch, isStreaming, onImageClick }: { block: TextContent; keywords?: string[]; isSearchMatch?: boolean; isStreaming?: boolean; onImageClick?: (src: string) => void }) {
  const text = highlightTextAsHtml(block.text, keywords, isSearchMatch);
  const components = useMarkdownComponents(isStreaming, onImageClick);
  const streamReveal = isStreaming && !isSearchMatch;
  const prevLenRef = useRef(0);
  useEffect(() => {
    prevLenRef.current = block.text.length;
  }, [block.text]);
  const settled = streamReveal ? prevLenRef.current : block.text.length;
  const delta = streamReveal ? block.text.slice(settled) : "";
  const tailTokens = delta.split(/(\s+)/).filter((token) => token.length > 0);

  return (
    <div className={`markdown-body${streamReveal ? " markdown-body--streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {streamReveal ? text.slice(0, settled) : text}
      </ReactMarkdown>
      {streamReveal && tailTokens.length > 0 && (
        <span>
          {tailTokens.map((token, index) =>
            /^\s+$/.test(token) ? (
              <span key={`${settled}-${index}`}>{token}</span>
            ) : (
              <span key={`${settled}-${index}`} className="streaming-word" style={{ animationDelay: `${Math.min(index * 25, 250)}ms` }}>
                {token}
              </span>
            ),
          )}
        </span>
      )}
      {streamReveal && <span className="streaming-cursor" aria-hidden />}
    </div>
  );
}

function ThinkingBlock({ block, keywords, isSearchMatch, isStreaming, onImageClick }: { block: ThinkingContent; keywords?: string[]; isSearchMatch?: boolean; isStreaming?: boolean; onImageClick?: (src: string) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!!isSearchMatch);
  const userExpandedRef = useRef(false);
  useEffect(() => {
    if (!userExpandedRef.current && !isSearchMatch) setExpanded(false);
  }, [isSearchMatch]);
  const collapseNonce = useCollapseNonce();
  useEffect(() => {
    if (collapseNonce > 0) setExpanded(false);
  }, [collapseNonce]);
  const toggle = () => {
    setExpanded((current) => {
      const next = !current;
      if (next) userExpandedRef.current = true;
      return next;
    });
  };
  const thinkingPreview = useMemo(() => block.thinking.replace(/\s+/g, " ").trim(), [block.thinking]);
  const components = useMarkdownComponents(isStreaming, onImageClick);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;
    toggle();
  };
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const text = highlightTextAsHtml(block.thinking, keywords, isSearchMatch);

  return (
    <div
      onClick={handleClick}
      aria-expanded={expanded}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      style={{
        height: contentHeight ?? "auto",
        overflow: "hidden",
        cursor: "pointer",
        transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
      }}
    >
      <div ref={contentRef} style={{ overflow: "hidden" }}>
        <div
          className="thinking-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 4px",
            fontSize: 12.5,
            textAlign: "left",
          }}
        >
          <span aria-hidden className="thinking-chevron" data-expanded={expanded ? "true" : "false"} style={{ display: "inline-flex", width: 10, color: "var(--text-dim)", flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
          {expanded ? (
            <span className="thinking-header-label" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
              {t("Thinking")}
            </span>
          ) : (
            <span className={`thinking-collapsed${isStreaming && !expanded && block.thinking.trim().length > 0 ? " thinking-live--muted" : ""}`} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {thinkingPreview}
            </span>
          )}
        </div>
        {expanded && (
          <div className="thinking-expanded markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallBlock({ block, result }: { block: ToolCallContent; result?: ToolResultMessage }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const collapseNonce = useCollapseNonce();
  useEffect(() => {
    if (collapseNonce > 0) setExpanded(false);
  }, [collapseNonce]);
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const inputStr = JSON.stringify(block.input, null, 2);

  const resultText = result
    ? result.content.filter((item): item is { type: "text"; text: string } => item.type === "text").map((item) => item.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;

  const isShowFile = isShowFileToolName(block.toolName);
  const showFilePaths: string[] | null = (() => {
    if (!isShowFile || !block.input) return null;
    const raw = block.input.paths;
    if (!Array.isArray(raw)) return null;
    const filtered = raw.filter((path): path is string => typeof path === "string" && path.length > 0);
    return filtered.length > 0 ? filtered : null;
  })();
  const showFileResults = useShowFileResults();
  const showFileFailedCount = (() => {
    if (!isShowFile) return 0;
    const files = showFileResults.get(block.toolCallId);
    if (!files) return 0;
    return files.filter((file) => !file.exists).length;
  })();
  const handleOpenInLibrary = () => {
    openSessionLibrary({ focusToolCallId: block.toolCallId });
  };

  return (
    <div
      style={{
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 12,
        border: isError ? "1px solid rgba(248,113,113,0.45)" : "1px solid rgba(34,197,94,0.25)",
        background: isError ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: isError ? "#f87171" : "#16a34a", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {block.toolName}
        </span>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        {isShowFile && showFilePaths && (
          <Tooltip content={t("Open in session library")}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInLibrary();
              }}
              aria-label={t("Open in session library")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: showFileFailedCount > 0 ? "#f87171" : "var(--text-muted)",
                background: showFileFailedCount > 0 ? "rgba(248,113,113,0.08)" : "var(--bg-selected)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>
                {showFileFailedCount > 0
                  ? t("{n} files added · {m} failed", { n: showFilePaths.length, m: showFileFailedCount })
                  : showFilePaths.length === 1
                    ? t("{n} file added", { n: 1 })
                    : t("{n} files added", { n: showFilePaths.length })}
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          </Tooltip>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </div>

      <div style={{ height: contentHeight ?? "auto", overflow: "hidden", transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none" }}>
        <div ref={contentRef} style={{ overflow: "hidden" }}>
          {expanded && (
            <>
              <pre
                data-scroll-inset
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflowX: "hidden",
                  overflowY: "auto",
                  background: "var(--bg-subtle)",
                  borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {inputStr}
              </pre>
              {result && <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        data-scroll-inset
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12,
          lineHeight: 1.5,
          overflowX: "hidden",
          overflowY: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? `(${t("No output")})` : text}
      </pre>
    </div>
  );
}
