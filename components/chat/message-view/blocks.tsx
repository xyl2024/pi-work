"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import { Tooltip } from "../../ui/Tooltip";
import { openSessionLibrary } from "@/hooks/sessionLibraryStore";
import { isShowFileToolName } from "@/lib/shared/show-file-tool-types";
import { extractEditDiffStats, extractWriteDiffStats } from "@/lib/shared/tool-diff-stats";
import { useShowFileResults } from "@/hooks/showFileResultsStore";
import { useMarkdownComponents, highlightTextAsHtml, getToolPreview } from "./utils";
import { SpawnSubagentLivePanel } from "./SpawnSubagentLivePanel";
import { useCollapseNonce } from "./context";
import type { AssistantContentBlock, TextContent, ToolCallContent, ThinkingContent, ToolResultMessage } from "@/lib/shared/types";

export function BlockView({ block, toolResults, isStreaming, isLast, keywords, isSearchMatch, onImageClick, cwd }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; isLast?: boolean; keywords?: string[]; isSearchMatch?: boolean; onImageClick?: (src: string) => void; cwd?: string | null }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} keywords={keywords} isSearchMatch={isSearchMatch} isStreaming={isStreaming} onImageClick={onImageClick} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} keywords={keywords} isSearchMatch={isSearchMatch} isStreaming={isLast && isStreaming} onImageClick={onImageClick} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} cwd={cwd} />;
  }
  return null;
}

function TextBlock({ block, keywords, isSearchMatch, isStreaming, onImageClick }: { block: TextContent; keywords?: string[]; isSearchMatch?: boolean; isStreaming?: boolean; onImageClick?: (src: string) => void }) {
  const text = highlightTextAsHtml(block.text, keywords, isSearchMatch);
  const components = useMarkdownComponents(isStreaming, onImageClick);

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingBlock({ block, keywords, isSearchMatch, isStreaming, onImageClick }: { block: ThinkingContent; keywords?: string[]; isSearchMatch?: boolean; isStreaming?: boolean; onImageClick?: (src: string) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const userExpandedRef = useRef(false);
  const previousSearchMatchRef = useRef(isSearchMatch);
  useEffect(() => {
    // Thinking blocks start collapsed. When a search highlight goes away,
    // fold an untouched thinking block back up.
    if (previousSearchMatchRef.current && !isSearchMatch && !userExpandedRef.current) {
      setExpanded(false);
    }
    previousSearchMatchRef.current = isSearchMatch;
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

  // ── "Flowing" folded preview (streaming tail view) ─────────────
  // While this block is the live tail of a streaming message and stays
  // folded, show the *newest line* of the thinking text and right-pin it to
  // the cell edge — a pure-CSS news-ticker effect (flex +
  // justify-content:flex-end + width:max-content), lifted from deepseek-
  // harness's ReasoningRow. Each React commit just grows the text and the
  // browser relayouts once: the overflow clips out through the left edge at
  // the exact pace the model writes — no rAF/transform/catch-up animation
  // to stutter or fight the stream. When the stream moves on (or the block
  // is expanded) the attribute drops and the idle ellipsized head preview
  // comes back. Clicking still folds/unfolds it.
  const flowing = Boolean(isStreaming) && !expanded;
  const streamingLine = useMemo(() => {
    const newline = block.thinking.lastIndexOf("\n");
    const tail = newline === -1 ? block.thinking : block.thinking.slice(newline + 1);
    return tail.trim();
  }, [block.thinking]);

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
            <span className="thinking-collapsed" data-follow-end={flowing || undefined}>
              <span className="thinking-collapsed-inner">
                {flowing ? streamingLine : thinkingPreview}
              </span>
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

function ToolCallBlock({ block, result, cwd }: { block: ToolCallContent; result?: ToolResultMessage; cwd?: string | null }) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const isBash = block.toolName === "bash";
  const isFileMutation = block.toolName === "write" || block.toolName === "edit";
  const isSpawnSubagent = block.toolName === "spawn_subagent";
  // Only the specialized renderers (bash / diff for edit & write / the
  // subagent live panel) stay expanded by default; every other tool call
  // block collapses by default.
  const isSpecialized = isBash || isFileMutation || isSpawnSubagent;
  const isCollapsedByDefault = !isSpecialized;
  const timeout = isBash && (typeof block.input.timeout === "number" || typeof block.input.timeout === "string")
    ? String(block.input.timeout)
    : null;
  const [expanded, setExpanded] = useState(!isCollapsedByDefault);
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

  // Added/deleted line counts derived purely from the tool's own data:
  // edit → result details' diff payload (persisted in the session JSONL);
  // write → the input content. Never from git. Null while streaming.
  const diffStats = useMemo(() => {
    if (!isFileMutation) return null;
    if (isError) return null;
    return block.toolName === "edit"
      ? extractEditDiffStats(result?.details)
      : extractWriteDiffStats(block.input);
  }, [isFileMutation, isError, block, result]);

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

  // spawn_subagent: while the child session is still running, the output area
  // shows the live activity panel (details arrive via in-flight
  // tool_execution_update partials). Once the final result lands it replaces
  // the panel entirely.
  const subDetails = isSpawnSubagent
    ? ((result?.details ?? null) as { status?: string; sessionId?: string | null } | null)
    : null;
  const subagentHasResultText = !!result && result.content.some((item) => item.type === "text" && item.text.trim().length > 0);
  const subagentTerminal = subDetails?.status === "completed" || subDetails?.status === "failed" || subDetails?.status === "cancelled" || isError;
  const isSubagentRunning = isSpawnSubagent && !subagentHasResultText && !subagentTerminal;

  const header = (
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
        {timeout !== null && (
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, flexShrink: 0 }}>
            timeout={timeout}s
          </span>
        )}
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        {diffStats && (
          <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <span style={{ color: "#16a34a" }}>+{diffStats.additions}</span>
            {diffStats.deletions > 0 && <span style={{ color: "#f87171", marginLeft: 3 }}>-{diffStats.deletions}</span>}
          </span>
        )}
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
        {isSubagentRunning && (
          <span aria-hidden="true" className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", flexShrink: 0 }} />
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
    </div>
  );

  if (isBash) {
    // Bash blocks render their terminal-like content directly: no collapse,
    // no header. The long output is capped inside BashToolCallContent with a
    // click-to-expand mask instead.
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
        <BashToolCallContent command={typeof block.input.command === "string" ? block.input.command : ""} timeout={timeout} cwd={cwd} resultText={resultText} resultIsEmpty={resultIsEmpty} isError={isError} isDark={isDark} />
      </div>
    );
  }

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
      {header}

      <div style={{ height: contentHeight ?? "auto", overflow: "hidden", transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none" }}>
        <div ref={contentRef} style={{ overflow: "hidden" }}>
          {expanded && isFileMutation ? (
            <DiffToolCallContent toolName={block.toolName} input={block.input} resultText={resultText} resultIsEmpty={resultIsEmpty} isError={isError} isDark={isDark} />
          ) : expanded && (
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
              {isSpawnSubagent && isSubagentRunning ? (
                <SpawnSubagentLivePanel childSessionId={subDetails?.sessionId ?? null} />
              ) : (
                result && <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface DiffLine {
  kind: "added" | "removed";
  text: string;
}

function buildDiffLines(toolName: string, input: Record<string, unknown>): DiffLine[] {
  if (toolName === "write") {
    const content = typeof input.content === "string" ? input.content : "";
    return content.split("\n").map((text) => ({ kind: "added", text: text.replace(/\r$/, "") }));
  }

  const edits = Array.isArray(input.edits)
    ? input.edits
    : [{ oldText: input.oldText, newText: input.newText }];
  const lines: DiffLine[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") continue;
    const item = edit as Record<string, unknown>;
    const oldText = typeof item.oldText === "string" ? item.oldText : "";
    const newText = typeof item.newText === "string" ? item.newText : "";
    for (const text of oldText.split("\n")) lines.push({ kind: "removed", text: text.replace(/\r$/, "") });
    for (const text of newText.split("\n")) lines.push({ kind: "added", text: text.replace(/\r$/, "") });
  }
  return lines;
}

function DiffToolCallContent({ toolName, input, resultText, resultIsEmpty, isError, isDark }: {
  toolName: string;
  input: Record<string, unknown>;
  resultText: string | null;
  resultIsEmpty: boolean;
  isError: boolean;
  isDark: boolean;
}) {
  const { t } = useI18n();
  const lines = buildDiffLines(toolName, input);
  return (
    <div
      data-scroll-inset
      style={{
        overflow: "hidden",
        background: isDark ? "#1e1e1e" : "#fafafa",
        borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div className="no-scrollbar" style={{ overflowX: "auto", padding: 0, scrollbarWidth: "none" }}>
        {/* Keep the diff rows inside an inline-block that grows to the widest
            line. Without this, each row only paints to the viewport width,
            so its background disappears when scrolling horizontally. */}
        <div style={{ display: "inline-block", minWidth: "100%" }}>
          {lines.length > 0 ? lines.map((line, index) => (
            <div
              key={`${line.kind}-${index}`}
              style={{
                display: "flex",
                width: "100%",
                padding: "1px 10px",
                color: line.kind === "added" ? (isDark ? "#b7f7c0" : "#166534") : (isDark ? "#ffc1c1" : "#991b1b"),
                background: line.kind === "added"
                  ? (isDark ? "rgba(46,160,67,0.22)" : "rgba(34,197,94,0.13)")
                  : (isDark ? "rgba(248,81,73,0.22)" : "rgba(248,113,113,0.14)"),
                whiteSpace: "pre",
              }}
            >
              <span style={{ width: 16, flexShrink: 0, userSelect: "none" }}>{line.kind === "added" ? "+" : "-"}</span>
              <span>{line.text || " "}</span>
            </div>
          )) : (
            <div style={{ padding: "4px 10px", color: "var(--text-dim)" }}>{t("Empty")}</div>
          )}
        </div>
      </div>
      {resultText !== null && <PairedResult text={resultText} isEmpty={resultIsEmpty} isError={isError} />}
    </div>
  );
}

const BASH_DETAIL_MAX_HEIGHT = 200;

function BashToolCallContent({ command, timeout, cwd, resultText, resultIsEmpty, isError, isDark }: {
  command: string;
  timeout: string | null;
  cwd?: string | null;
  resultText: string | null;
  resultIsEmpty: boolean;
  isError: boolean;
  isDark: boolean;
}) {
  const { t } = useI18n();
  const [expandedAll, setExpandedAll] = useState(false);
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const showMask = contentHeight !== null && contentHeight > BASH_DETAIL_MAX_HEIGHT && !expandedAll;
  const cwdBase = cwd?.replace(/\\/g, "/").split("/").pop() || "";
  const prompt = cwdBase ? `${cwdBase} % ` : "% ";
  const terminalBg = isDark ? "#1e1e1e" : "#f7f7f7";
  const fg = isDark ? "#d4d4d4" : "#24292e";
  const dimFg = isDark ? "#9ca3af" : "#6b7280";
  return (
    <div
      style={{
        position: "relative",
        height: expandedAll ? (contentHeight === null ? "auto" : contentHeight) : (contentHeight === null ? "auto" : Math.min(contentHeight, BASH_DETAIL_MAX_HEIGHT)),
        overflow: "hidden",
        transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
      }}
    >
    <div
      ref={contentRef}
      data-scroll-inset
      style={{
        padding: "8px 10px",
        background: terminalBg,
        color: fg,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.5,
        overflowX: "auto",
        whiteSpace: "pre",
      }}
    >
      {timeout !== null && (
        <div style={{ color: dimFg }}>(timeout={timeout}s)</div>
      )}
      <span style={{ color: isError ? "#f87171" : "#16a34a" }}>{prompt}</span>
      <SyntaxHighlighter
        language="bash"
        style={isDark ? vscDarkPlus : vs}
        PreTag="span"
        customStyle={{ margin: 0, padding: 0, background: terminalBg, fontSize: "inherit", lineHeight: "inherit", display: "inline", border: "none" }}
        codeTagProps={{ style: { background: terminalBg, fontFamily: "inherit", whiteSpace: "pre", border: "none" } }}
      >
        {command}
      </SyntaxHighlighter>
      {resultText !== null && (
        resultIsEmpty ? (
          <pre
            style={{
              margin: 0,
              padding: 0,
              color: isError ? "#f87171" : dimFg,
              font: "inherit",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontStyle: "italic",
              opacity: 0.6,
            }}
          >
            {`(${t("No output")})`}
          </pre>
        ) : isError ? (
          <pre
            style={{
              margin: 0,
              padding: 0,
              color: "#f87171",
              font: "inherit",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {resultText}
          </pre>
        ) : (
          <SyntaxHighlighter
            language="bash"
            style={isDark ? vscDarkPlus : vs}
            PreTag="pre"
            customStyle={{ margin: 0, padding: 0, background: terminalBg, fontSize: "inherit", lineHeight: "inherit", border: "none", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            codeTagProps={{ style: { background: terminalBg, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "none" } }}
          >
            {resultText}
          </SyntaxHighlighter>
        )
      )}
    </div>

    {!expandedAll && showMask && (
      <button
        onClick={() => setExpandedAll(true)}
        aria-label={t("Expand")}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          border: "none",
          padding: 0,
          background: `linear-gradient(to bottom, rgba(0,0,0,0), ${terminalBg})`,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--text-muted)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    )}
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
