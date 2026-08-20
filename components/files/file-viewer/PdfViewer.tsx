"use client";

import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi } from "@/lib/shared/file-paths";
import { useToast } from "../../ui/Toast";
import { Tooltip } from "../../ui/Tooltip";
import { formatSize, type FileViewerProps } from "./utils";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function PdfViewer({ filePath }: FileViewerProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [manualScale, setManualScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageNaturalWidth, setPageNaturalWidth] = useState(0);
  const [outline, setOutline] = useState<Array<{ title: string; pageNumber: number; depth: number }>>([]);
  const [showOutline, setShowOutline] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const outlineBtnRef = useRef<HTMLButtonElement>(null);
  const numPagesRef = useRef(0);

  // SSE watch — same pattern as ImageViewer/AudioViewer
  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);
    setNumPages(0);
    setPageNumber(1);
    setFitWidth(true);
    setManualScale(1);
    setPageNaturalWidth(0);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath]);

  // Track container width for fit-to-width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts: ← → for page navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const editable = document.activeElement?.getAttribute("contenteditable");
      if (editable === "true" || editable === "") return;

      if (e.key === "ArrowLeft") {
        setPageNumber((prev) => Math.max(1, prev - 1));
      } else if (e.key === "ArrowRight") {
        setPageNumber((prev) => Math.min(numPagesRef.current || 1, prev + 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Click outside outline dropdown to close
  useEffect(() => {
    if (!showOutline) return;
    function onClick(e: MouseEvent) {
      if (outlineBtnRef.current && !outlineBtnRef.current.contains(e.target as Node)) {
        setShowOutline(false);
      }
    }
    // Delay so the toggle click doesn't immediately close
    const id = setTimeout(() => document.addEventListener("click", onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", onClick);
    };
  }, [showOutline]);

  function handleOutlineClick(pageNum: number) {
    setPageNumber(pageNum);
    setShowOutline(false);
  }

  const encoded = encodeFilePathForApi(filePath);
  const src = `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function flattenOutline(items: any[], doc: any, depth: number): Promise<Array<{ title: string; pageNumber: number; depth: number }>> {
    const result: Array<{ title: string; pageNumber: number; depth: number }> = [];
    if (!items) return result;
    for (const item of items) {
      let pageNumber = 0;
      if (item.dest) {
        try {
          if (typeof item.dest === "string") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resolved: any = await doc.getDestination(item.dest);
            if (Array.isArray(resolved) && resolved[0]) {
              const idx: number = await doc.getPageIndex(resolved[0]);
              pageNumber = idx + 1;
            }
          } else if (Array.isArray(item.dest) && item.dest[0]) {
            const idx: number = await doc.getPageIndex(item.dest[0]);
            pageNumber = idx + 1;
          }
        } catch { /* skip unresolvable dest */ }
      }
      if (pageNumber > 0) {
        result.push({ title: item.title, pageNumber, depth });
      }
      if (item.items) {
        const children = await flattenOutline(item.items, doc, depth + 1);
        result.push(...children);
      }
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onDocumentLoadSuccess(doc: any) {
    setNumPages(doc.numPages);
    numPagesRef.current = doc.numPages;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.getOutline().then((rawOutline: any[]) => {
      if (rawOutline && rawOutline.length > 0) {
        flattenOutline(rawOutline, doc, 0).then(setOutline);
      }
    }).catch(() => { /* PDF has no outline or failed to load */ });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onPageLoadSuccess(page: any) {
    if (page.originalWidth > 0) {
      setPageNaturalWidth(page.originalWidth);
    }
  }

  function changePage(delta: number) {
    setPageNumber((prev) => Math.max(1, Math.min(numPages || 1, prev + delta)));
  }

  function handlePageInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const val = parseInt(e.currentTarget.value, 10);
      if (Number.isFinite(val) && val >= 1 && val <= numPages) {
        setPageNumber(val);
      }
      e.currentTarget.value = "";
    }
  }

  function changeScale(delta: number) {
    setFitWidth(false);
    setManualScale((prev) =>
      Math.round(Math.max(0.5, Math.min(3, prev + delta)) * 100) / 100,
    );
  }

  function resetFitWidth() {
    setFitWidth(true);
    setManualScale(1);
  }

  // Compute display percentage and effective scale
  const displayPercent = fitWidth && pageNaturalWidth > 0 && containerWidth > 0
    ? Math.round(containerWidth * 0.9 / pageNaturalWidth * 100)
    : Math.round(manualScale * 100);
  const effectiveScale = fitWidth && containerWidth > 0 && pageNaturalWidth > 0
    ? containerWidth * 0.9 / pageNaturalWidth
    : manualScale;

  const formatSizeStr = size != null ? formatSize(size) : null;

  const btnBase: React.CSSProperties = {
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    background: "var(--bg-hover)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    fontFamily: "var(--font-mono)",
    lineHeight: "18px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        {formatSizeStr && <span>{formatSizeStr}</span>}

        {/* Page navigation */}
        <button
          onClick={() => changePage(-1)}
          disabled={pageNumber <= 1}
          style={{ ...btnBase, opacity: pageNumber <= 1 ? 0.4 : 1, cursor: pageNumber <= 1 ? "default" : "pointer" }}
        >
          ‹
        </button>
        <input
          ref={pageInputRef}
          type="text"
          defaultValue={String(pageNumber)}
          key={pageNumber}
          onKeyDown={handlePageInputKey}
          style={{
            width: 36,
            textAlign: "center",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text)",
            fontSize: 11,
            padding: "2px 2px",
            fontFamily: "var(--font-mono)",
          }}
        />
        <span style={{ color: "var(--text-dim)", minWidth: 28, textAlign: "center" }}>
          / {numPages || "…"}
        </span>
        <button
          onClick={() => changePage(1)}
          disabled={pageNumber >= numPages}
          style={{ ...btnBase, opacity: pageNumber >= numPages ? 0.4 : 1, cursor: pageNumber >= numPages ? "default" : "pointer" }}
        >
          ›
        </button>

        {/* Zoom controls */}
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <button
          onClick={() => changeScale(-0.25)}
          disabled={!fitWidth && manualScale <= 0.5}
          style={{ ...btnBase, opacity: !fitWidth && manualScale <= 0.5 ? 0.4 : 1, cursor: !fitWidth && manualScale <= 0.5 ? "default" : "pointer" }}
        >
          −
        </button>
        <button
          onClick={resetFitWidth}
          style={{
            ...btnBase,
            minWidth: 46,
            fontWeight: fitWidth ? 700 : 400,
            color: fitWidth ? "var(--accent)" : "var(--text-dim)",
          }}
          title={fitWidth ? t("Fit to width") : t("Reset to fit width")}
        >
          {displayPercent}%
        </button>
        <button
          onClick={() => changeScale(0.25)}
          disabled={!fitWidth && manualScale >= 3}
          style={{ ...btnBase, opacity: !fitWidth && manualScale >= 3 ? 0.4 : 1, cursor: !fitWidth && manualScale >= 3 ? "default" : "pointer" }}
        >
          +
        </button>

        {/* Outline button */}
        {outline.length > 0 && (
          <span style={{ position: "relative" }}>
            <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px", display: "inline-block" }} />
            <button
              ref={outlineBtnRef}
              onClick={() => setShowOutline((s) => !s)}
              style={{ ...btnBase }}
              title={t("Table of contents")}
            >
              ☰
            </button>
            {showOutline && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 4,
                  minWidth: 220,
                  maxWidth: 360,
                  maxHeight: 400,
                  overflow: "auto",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                  zIndex: 100,
                  padding: "4px 0",
                }}
              >
                {outline.map((item, i) => (
                  <div
                    key={i}
                    onClick={() => handleOutlineClick(item.pageNumber)}
                    style={{
                      padding: "3px 10px",
                      paddingLeft: 10 + item.depth * 16,
                      fontSize: 11,
                      cursor: "pointer",
                      color: item.pageNumber === pageNumber ? "var(--accent)" : "var(--text)",
                      background: item.pageNumber === pageNumber ? "var(--bg-hover)" : "transparent",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}

        {/* Watch indicator */}
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <Tooltip content={watching ? t("Live sync active") : t("Not watching")}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: watching ? "#4ade80" : "var(--border)",
                display: "inline-block",
                boxShadow: watching ? "0 0 4px #4ade80" : "none",
              }}
            />
            {watching ? t("live") : t("static")}
          </span>
        </Tooltip>
      </div>

      {/* PDF content area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: 16,
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13, marginTop: 40 }}>{error}</div>
        ) : (
          <Document
            file={src}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={() => {
              if (!error) toast.show({ kind: "error", message: t("Failed to load file") });
              setError(t("Failed to load PDF"));
            }}
            loading={
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 40 }}>
                {t("Loading...")}
              </div>
            }
          >
            {/* Preload previous page (hidden) */}
            {numPages > 0 && pageNumber > 1 && (
              <div style={{ display: "none" }}>
                <Page
                  pageNumber={pageNumber - 1}
                  scale={effectiveScale}
                />
              </div>
            )}
            {/* Current page */}
            <Page
              key={`${src}-p${pageNumber}`}
              pageNumber={pageNumber}
              onLoadSuccess={onPageLoadSuccess}
              onRenderError={() => setError(t("Failed to render PDF page"))}
              scale={effectiveScale}
            />
            {/* Preload next page (hidden) */}
            {numPages > 0 && pageNumber < numPages && (
              <div style={{ display: "none" }}>
                <Page
                  pageNumber={pageNumber + 1}
                  scale={effectiveScale}
                />
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}
