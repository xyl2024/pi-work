"use client";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { parseFileDiff, type GitDeletedBlock, type GitLineMarkType } from "@/lib/git-line-marks";
import { CodeBlock } from "../CodeBlock";
import { EchartsBlock } from "../EchartsBlock";
import { FileSearchBar } from "../FileSearchBar";
import { extractImageGallery, ImageLightbox, MarkdownImage } from "../ImageLightbox";
import { MermaidBlock } from "../MermaidBlock";
import { SvgBlock } from "../SvgBlock";
import { Tooltip } from "../Tooltip";
import { DiffView } from "./DiffView";
import { VirtualizedCodeLines } from "./VirtualizedCodeLines";
import {
  CODE_LINE_HEIGHT,
  CODE_TOP_PADDING,
  GIT_ADDED_COLOR,
  GIT_DELETED_COLOR,
  GIT_MODIFIED_COLOR,
  VIRTUALIZE_MIN_BYTES,
  VIRTUALIZE_MIN_LINES,
  formatSize,
  resolveRelativePath,
  type FileData,
  type FileViewerProps,
} from "./utils";

export function TextViewer({ filePath, cwd }: FileViewerProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Git gutter marks (VS Code style): line → added/modified, plus deleted
  // blocks rendered as collapsible markers. null = not loaded / no diff /
  // truncated (fall back to no marks).
  const [gitMarks, setGitMarks] = useState<Map<number, GitLineMarkType> | null>(null);
  const [gitDeletedBlocks, setGitDeletedBlocks] = useState<GitDeletedBlock[]>([]);
  const [expandedDelete, setExpandedDelete] = useState<number | null>(null);
  // Inline search state. `searchInputValue` updates on every keystroke for a
  // responsive input field; `searchQuery` lags behind by 250ms (see effect
  // below) and is what drives match computation.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Resolve raw markdown image src → final URL. Pass-through for external/data
  // URLs and already-rewritten /api/files/... paths; rewrite relative paths
  // against the markdown file's directory.
  const resolveSrc = useCallback((raw: string): string => {
    if (/^(https?:|data:|blob:|\/api\/files\/)/i.test(raw)) {
      return raw;
    }
    const resolved = resolveRelativePath(raw, filePath);
    return `/api/files/${encodeFilePathForApi(resolved)}?type=read`;
  }, [filePath]);

  // Gallery of every image reference in the markdown content, for lightbox
  // prev/next navigation. Recomputed only when the source or path changes.
  const gallery = useMemo(
    () => (data?.language === "markdown" ? extractImageGallery(data.content, resolveSrc) : []),
    [data, resolveSrc],
  );

  // Markdown renderers for ReactMarkdown. Hoisted to the top level so the
  // useMemo runs on every render in a stable position — calling it inside the
  // JSX prop would skip it on renders where the markdown branch isn't reached,
  // which violates the Rules of Hooks and triggers React's hook-order warning.
  const markdownComponents = useMemo(
    () => ({
      img: (props: { src?: string | Blob; alt?: string }) => (
        <MarkdownImage
          {...props}
          resolveSrc={resolveSrc}
          onImageClick={(src) => {
            const idx = gallery.findIndex((g) => g.src === src);
            if (idx >= 0) setLightboxIndex(idx);
          }}
        />
      ),
      code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
        const lang = className?.replace("language-", "") ?? "";
        const raw = String(children ?? "");
        const isBlock = className?.includes("language-") || raw.includes("\n");
        if (isBlock) {
          if (lang === "mermaid") {
            // Stable key keeps the MermaidBlock instance alive across re-renders.
            return <MermaidBlock key={raw} code={raw.replace(/\n$/, "")} />;
          }
          if (lang === "svg") {
            // Stable key keeps the SvgBlock instance alive across re-renders.
            return <SvgBlock key={raw} code={raw.replace(/\n$/, "")} />;
          }
          if (lang === "echarts") {
            // Stable key keeps the EchartsBlock instance alive across re-renders.
            return <EchartsBlock key={raw} code={raw.replace(/\n$/, "")} />;
          }
          return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
        }
        return (
          <code
            style={{
              background: "var(--bg-selected)",
              padding: "1px 4px",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: "0.9em",
            }}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    }),
    [resolveSrc, gallery],
  );

  // ── Inline search ────────────────────────────────────────────────
  // 250ms debounce on the raw input value → drives match computation.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInputValue), 250);
    return () => clearTimeout(id);
  }, [searchInputValue]);

  // Find every match position in the current file content. Returns the
  // 1-based line number for each match — used by `lineProps` to paint a
  // background on matching lines and by the scroll-into-view effect.
  const searchMatches = useMemo(() => {
    if (!data || !searchQuery) return [];
    const needle = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
    if (!needle) return [];
    const haystack = searchCaseSensitive ? data.content : data.content.toLowerCase();
    const results: Array<{ line: number }> = [];
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
      const before = data.content.slice(0, pos);
      const line = (before.match(/\n/g)?.length ?? 0) + 1;
      results.push({ line });
      pos += needle.length;
    }
    return results;
  }, [data, searchQuery, searchCaseSensitive]);

  const matchedLines = useMemo(
    () => new Set(searchMatches.map((m) => m.line)),
    [searchMatches],
  );
  const currentMatchLine = searchMatches[searchMatchIndex]?.line ?? null;

  // Split once per content change and derive the virtualization flag early
  // (the search-scroll effect below needs it, and re-splitting a multi-MB
  // string on every render would defeat the whole point of this feature).
  const contentLines = useMemo(() => (data ? data.content.split("\n") : []), [data]);
  const virtualize =
    !!data &&
    (contentLines.length > VIRTUALIZE_MIN_LINES || data.size > VIRTUALIZE_MIN_BYTES);

  // Clamp the current match index when match count changes (SSE update,
  // case toggle, or query edit) so we never point past the end.
  useEffect(() => {
    setSearchMatchIndex((i) =>
      searchMatches.length === 0 ? 0 : Math.min(i, searchMatches.length - 1),
    );
  }, [searchMatches.length]);

  // Ctrl/Cmd+F toggles the search bar. Mirrors the ChatWindow pattern.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "f") return;
      if (!data) return;
      e.preventDefault();
      setSearchOpen((v) => !v);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data]);

  // Scroll the current match into view (centered). No-op if the search bar
  // is closed or the match is on a line that's not currently mounted (e.g.
  // when the user is viewing the diff or preview branches). In virtualized
  // mode the target row may not be mounted at all, so scroll the window
  // container directly instead of hunting for the DOM node.
  useEffect(() => {
    if (currentMatchLine == null) return;
    if (virtualize) {
      const el = contentRef.current?.querySelector<HTMLElement>(".fv-virtual-scroll");
      if (!el) return;
      const targetTop = CODE_TOP_PADDING + (currentMatchLine - 1) * CODE_LINE_HEIGHT;
      const viewportH = el.clientHeight;
      el.scrollTo({
        top: Math.max(0, targetTop - (viewportH - CODE_LINE_HEIGHT) / 2),
        behavior: "smooth",
      });
    } else {
      const el = contentRef.current?.querySelector(`[data-fv-line="${currentMatchLine}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentMatchLine, virtualize]);

  // ── End inline search ────────────────────────────────────────────

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    const encoded = encodeFilePathForApi(filePath);
    return fetch(`/api/files/${encoded}?type=read`)
      .then((r) => r.json())
      .then((d: FileData & {
        error?: string;
        code?: string;
        kind?: "text" | "image" | "pdf";
        sizeBytes?: number;
        limitBytes?: number;
      }) => {
        if (d.error) {
          // Server-side 413s come with a machine-readable code + the
          // actual size/limit; translate them into a localized message
          // here so the user sees "文件过大：文本 文件 12.4 MB，超过 5
          // MB 限制" in zh, or the English equivalent — never the raw
          // English "text file too large: 12.4 MB exceeds the 5 MB
          // limit" string. Falls back to `d.error` for any other error
          // shape (404, 500, network) so behavior elsewhere is unchanged.
          if (
            d.code === "FILE_TOO_LARGE" &&
            d.kind &&
            typeof d.sizeBytes === "number" &&
            typeof d.limitBytes === "number"
          ) {
            const sizeMb = (d.sizeBytes / 1024 / 1024).toFixed(1);
            const limitMb = Math.round(d.limitBytes / 1024 / 1024);
            const kindLabelKey =
              d.kind === "image"
                ? "Image (file kind)"
                : d.kind === "pdf"
                ? "PDF (file kind)"
                : "Text (file kind)";
            setError(
              t("File too large: {kind} file is {size} MB, limit is {limit} MB", {
                kind: t(kindLabelKey),
                size: sizeMb,
                limit: limitMb,
              }),
            );
          } else {
            setError(d.error);
          }
          return null;
        }
        if (isRefresh) {
          setData((prev) => {
            if (prev) setPrevContent(prev.content);
            return d;
          });
          setChangeCount((c) => c + 1);
        } else {
          setData(d);
        }
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load git gutter marks: diff worktree vs HEAD (staged + unstaged
  // combined). Truncated diffs (>500KB) fall back to no marks rather than
  // risk wrong markers.
  const loadGitMarks = useCallback(() => {
    if (!cwd) {
      setGitMarks(null);
      setGitDeletedBlocks([]);
      return;
    }
    fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(filePath)}&base=head`)
      .then((r) => r.json())
      .then((d: { diff: string | null; truncated: boolean }) => {
        if (d.truncated || !d.diff) {
          setGitMarks(null);
          setGitDeletedBlocks([]);
          return;
        }
        const parsed = parseFileDiff(d.diff);
        setGitMarks(parsed.lineMarks);
        setGitDeletedBlocks(parsed.deletedBlocks);
      })
      .catch(() => {
        setGitMarks(null);
        setGitDeletedBlocks([]);
      });
  }, [cwd, filePath]);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPrevContent(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);
    setWatching(false);
    setLightboxIndex(null);
    setGitMarks(null);
    setGitDeletedBlocks([]);
    setExpandedDelete(null);
    // Reset inline search state on file switch — matches the spec ("clear on
    // filePath change"). The search bar unmounts because the conditional in
    // the JSX evaluates `!previewMode`; we explicitly clear the
    // state so reopening after a new file lands on an empty bar.
    setSearchOpen(false);
    setSearchInputValue("");
    setSearchQuery("");
    setSearchMatchIndex(0);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown") setPreviewMode(true);
    }).finally(() => setLoading(false));
    loadGitMarks();

    // Set up SSE watch
    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      fetchContent(filePath, true);
      loadGitMarks();
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, loadGitMarks]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        {t("Loading...")}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const lines = contentLines;
  const hasDiff = prevContent !== null && prevContent !== data.content;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span>{data.language}</span>

        {viewMode === "source" && <span>{lines.length} {t("lines")}</span>}
        {virtualize && viewMode === "source" && (
          <span style={{ color: "var(--text-dim)" }}>{t("virtualized")}</span>
        )}
        <span>{formatSize(data.size)}</span>

        {/* Live watch indicator */}
        <Tooltip content={watching ? t("Live sync active") : t("Not watching")}>
        <span
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? t("live") : t("static")}
        </span>
        </Tooltip>

        {/* Diff / Source toggle — shown only when there are changes */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              {t("Source")}
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              {t("Diff")} {changeCount > 0 && <span style={{ color: "#4ade80", marginLeft: 2 }}>+{changeCount}</span>}
            </button>
          </div>
        )}

        {/* Search toggle — opens the inline search bar (Ctrl+F). Source view only. */}
        {viewMode === "source" && !previewMode && (
          <Tooltip content={t("Search file")}>
            <button
              onClick={() => setSearchOpen((v) => !v)}
              aria-label={t("Search file")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 22,
                cursor: "pointer",
                background: searchOpen ? "var(--bg-selected)" : "var(--bg-hover)",
                color: searchOpen ? "var(--text)" : "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <Tooltip content={virtualize ? t("Word wrap is disabled for large files") : wrapLines ? t("Disable word wrap") : t("Enable word wrap")}>
          <button
            onClick={() => setWrapLines((v) => !v)}
            disabled={virtualize}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: virtualize ? "default" : "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
              opacity: virtualize ? 0.4 : 1,
            }}
          >
            {t("wrap")}
          </button>
          </Tooltip>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              {t("Code")}
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              {t("Preview")}
            </button>
          </div>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              {t("Preview")}
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              {t("Raw")}
            </button>
          </div>
        )}

      </div>

      {/* Inline search bar — mounted only in source view, hidden in preview / diff. */}
      {searchOpen && viewMode === "source" && !previewMode && (
        <FileSearchBar
          query={searchInputValue}
          onQueryChange={setSearchInputValue}
          caseSensitive={searchCaseSensitive}
          onCaseSensitiveChange={setSearchCaseSensitive}
          matchIndex={searchMatchIndex}
          matchCount={searchMatches.length}
          onPrev={() => setSearchMatchIndex((i) => Math.max(0, i - 1))}
          onNext={() =>
            setSearchMatchIndex((i) => Math.max(0, Math.min(searchMatches.length - 1, i + 1)))
          }
          onClose={() => {
            setSearchOpen(false);
            setSearchInputValue("");
            setSearchQuery("");
            setSearchMatchIndex(0);
          }}
          visible={searchOpen}
        />
      )}

      {/* Content area */}
      <div ref={contentRef} style={{ flex: 1, overflow: "auto", background: "var(--bg)", position: "relative" }}>
        {viewMode === "diff" && hasDiff ? (
          <DiffView oldContent={prevContent!} newContent={data.content} language={data.language} />
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={data.content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
          />
        ) : isMarkdown && previewMode ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px", maxWidth: 800 }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {data.content}
            </ReactMarkdown>
          </div>
        ) : virtualize ? (
          <VirtualizedCodeLines
            lines={lines}
            gitMarks={gitMarks}
            gitDeletedBlocks={gitDeletedBlocks}
            expandedDelete={expandedDelete}
            onToggleDelete={(i) => setExpandedDelete(expandedDelete === i ? null : i)}
            matchedLines={matchedLines}
            currentMatchLine={currentMatchLine}
          />
        ) : (
          <SyntaxHighlighter
            language={data.language === "text" ? "plaintext" : data.language}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            // Force per-line <span> wrappers when the search bar is open or
            // git gutter marks are present (react-syntax-highlighter only
            // calls `lineProps` when wrapLines is true). For
            // `language="text"` (plaintext, no tokens) the default would
            // skip wrapping entirely — that would silently disable all
            // highlights. Keep the user's wrap preference in effect when
            // the search bar is closed and there are no marks.
            wrapLines={searchOpen || wrapLines || (gitMarks !== null && gitMarks.size > 0)}
            lineNumberStyle={{
              color: "var(--text-dim)",
              fontStyle: "normal",
              minWidth: "3em",
              paddingRight: "1em",
            }}
            lineProps={(lineNumber: number) => {
              const isCurrent = lineNumber === currentMatchLine;
              const isMatch = !isCurrent && matchedLines.has(lineNumber);
              const mark = gitMarks?.get(lineNumber);
              const style: React.CSSProperties = {};
              if (mark === "added") style.borderLeft = `3px solid ${GIT_ADDED_COLOR}`;
              else if (mark === "modified") style.borderLeft = `3px solid ${GIT_MODIFIED_COLOR}`;
              if (isCurrent) style.background = "rgba(255, 200, 0, 0.30)";
              else if (isMatch) style.background = "rgba(255, 200, 0, 0.12)";
              return {
                "data-fv-line": lineNumber,
                style,
              };
            }}
            customStyle={{
              margin: 0,
              padding: "12px 0",
              background: "var(--bg)",
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: "var(--font-mono)",
              minHeight: "100%",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
            wrapLongLines={wrapLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}

        {/* Git deleted-block markers — absolutely positioned over the gutter
            (line numbers), showing a "−N" pill that expands the removed
            lines. Hidden while wrapping is on (line heights become unstable)
            and outside the source view. */}
        {viewMode === "source" && !previewMode && !wrapLines && !virtualize && gitDeletedBlocks.length > 0 && (
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 48, pointerEvents: "none", zIndex: 5 }}>
            {gitDeletedBlocks.map((block, i) => {
              const top = CODE_TOP_PADDING + (block.beforeLine - 1) * CODE_LINE_HEIGHT;
              const expanded = expandedDelete === i;
              return (
                <div key={i} style={{ position: "absolute", left: 0, top, width: 48 }}>
                  <button
                    onClick={() => setExpandedDelete(expanded ? null : i)}
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
                      pointerEvents: "auto",
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
        )}
      </div>
      {lightboxIndex !== null && gallery.length > 0 && (
        <ImageLightbox
          images={gallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
