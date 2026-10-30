"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type * as BeautifulMermaid from "beautiful-mermaid";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { copyText } from "@/lib/client/clipboard";
import { FullscreenOverlay } from "@/components/ui/FullscreenOverlay";

let libPromise: Promise<typeof BeautifulMermaid> | null = null;
function loadLib(): Promise<typeof BeautifulMermaid> {
  if (!libPromise) libPromise = import("beautiful-mermaid");
  return libPromise;
}

const FONT_IMPORT_RE = /@import url\([^)]+\);?\s*/g;

interface Props {
  code: string;
  isStreaming?: boolean;
}

export function MermaidBlock({ code, isStreaming }: Props) {
  const { t } = useI18n();
  const { preset, isDark } = useTheme();
  const [lib, setLib] = useState<typeof BeautifulMermaid | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, flashCopied] = useTransientFlag();
  const [asciiCopied, flashAsciiCopied] = useTransientFlag();
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");

  useEffect(() => {
    let cancelled = false;
    loadLib().then((m) => {
      if (!cancelled) setLib(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo<BeautifulMermaid.RenderOptions>(() => {
    const fallback = (name: string, def: string) => {
      if (typeof document === "undefined") return def;
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || def;
    };
    void preset;
    return {
      bg: fallback("--bg", "#ffffff"),
      fg: fallback("--text", "#1a1a1a"),
      accent: fallback("--accent", "#2563eb"),
      border: fallback("--border", "#e0e0e0"),
      surface: fallback("--bg-panel", "#f5f5f5"),
      muted: fallback("--text-muted", "#6b7280"),
      line: fallback("--border", "#e0e0e0"),
      transparent: true,
      font: "Inter",
    };
  }, [preset]);

  const { svg, error } = useMemo<{ svg: string | null; error: string | null }>(() => {
    if (!lib) return { svg: null, error: null };
    try {
      const raw = lib.renderMermaidSVG(code, options);
      const cleaned = raw.replace(FONT_IMPORT_RE, "");
      return { svg: cleaned, error: null };
    } catch (e) {
      return { svg: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code, lib, options]);

  const onCopy = useCallback(() => {
    void copyText(code).then(() => {
      flashCopied();
    });
  }, [code, flashCopied]);

  const onCopyAscii = useCallback(() => {
    if (!lib) return;
    try {
      const ascii = lib.renderMermaidASCII(code, {
        useAscii: true,
        colorMode: "none",
      });
      void copyText(ascii).then(() => {
        flashAsciiCopied();
      });
    } catch {
    }
  }, [code, lib, flashAsciiCopied]);

  const onDownload = useCallback(() => {
    if (!svg) return;
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', svg],
      { type: "image/svg+xml;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [svg]);

  const showRendered = viewMode === "rendered" && svg;
  const body = showRendered ? (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg)",
        overflow: "auto",
        maxHeight: "60vh",
        minHeight: 80,
      }}
    >
      <div
        dangerouslySetInnerHTML={{ __html: showRendered }}
        style={{
          display: "flex",
          justifyContent: "center",
          minWidth: "min-content",
        }}
      />
    </div>
  ) : (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: "var(--text)",
        fontFamily: "var(--font-mono-stack)",
        whiteSpace: "pre",
        background: "var(--bg)",
        overflow: "auto",
        maxHeight: "60vh",
        minHeight: 80,
      }}
    >
      {code}
    </pre>
  );

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 8,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        boxShadow: isDark
          ? "0 6px 18px rgba(0,0,0,0.35)"
          : "0 4px 14px rgba(0,0,0,0.08)",
      }}
    >
      <Header
        canExpand={!!svg || viewMode === "source"}
        onExpand={() => setExpanded(true)}
        onDownload={onDownload}
        onCopy={onCopy}
        copied={copied}
        onCopyAscii={onCopyAscii}
        asciiCopied={asciiCopied}
        canCopyAscii={!!lib}
        viewMode={viewMode}
        onToggleView={() => setViewMode((m) => (m === "rendered" ? "source" : "rendered"))}
      />
      {body}
      {error && !isStreaming && (
        <div
          style={{
            color: "#f87171",
            fontSize: 11,
            padding: "4px 10px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          {t("Failed to render Mermaid diagram")} — {error}
        </div>
      )}
      {expanded && (
        <FullscreenOverlay onClose={() => setExpanded(false)}>
          {showRendered ? (
            <div
              style={{
                width: "100%",
                height: "100%",
                overflow: "auto",
                padding: 24,
                boxSizing: "border-box",
                background: "var(--bg)",
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: showRendered }}
                style={{
                  minWidth: "min-content",
                  minHeight: "min-content",
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              />
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: 24,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                whiteSpace: "pre",
                background: "var(--bg)",
                width: "100%",
                height: "100%",
                overflow: "auto",
                boxSizing: "border-box",
              }}
            >
              {code}
            </pre>
          )}
        </FullscreenOverlay>
      )}
    </div>
  );
}

function Header({
  canExpand,
  onExpand,
  onDownload,
  onCopy,
  copied,
  onCopyAscii,
  asciiCopied,
  canCopyAscii,
  viewMode,
  onToggleView,
}: {
  canExpand: boolean;
  onExpand: () => void;
  onDownload: () => void;
  onCopy: () => void;
  copied: boolean;
  onCopyAscii: () => void;
  asciiCopied: boolean;
  canCopyAscii: boolean;
  viewMode: "rendered" | "source";
  onToggleView: () => void;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  return (
    <div
      style={{
        position: "relative",
        minHeight: 32,
        padding: "0 12px",
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-dim)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 11,
          color: "var(--text-muted)",
          fontFamily: "var(--font-sans)",
          pointerEvents: "none",
          maxWidth: "calc(100% - 240px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        mermaid
      </span>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
        <HeaderButton
          onClick={onExpand}
          disabled={!canExpand}
          ariaLabel={t("Click to expand")}
          title={t("Click to expand")}
        >
          ⛶
        </HeaderButton>
        <HeaderButton
          onClick={onToggleView}
          ariaLabel={viewMode === "source" ? t("View diagram") : t("View source")}
          title={viewMode === "source" ? t("View diagram") : t("View source")}
        >
          {"</>"}
        </HeaderButton>
        <HeaderButton
          onClick={onDownload}
          disabled={!canExpand}
          ariaLabel={t("Download SVG")}
          title={t("Download SVG")}
        >
          ↓
        </HeaderButton>
        <HeaderButton
          onClick={onCopyAscii}
          disabled={!canCopyAscii}
          ariaLabel={t("Copy as ASCII")}
          title={t("Copy as ASCII")}
        >
          {asciiCopied ? t("copied") : t("ASCII")}
        </HeaderButton>
        <HeaderButton
          onClick={onCopy}
          ariaLabel={t("copy")}
          title={t("copy")}
        >
          {copied ? t("copied") : t("copy")}
        </HeaderButton>
      </div>
    </div>
  );
}

function HeaderButton({
  onClick,
  disabled,
  ariaLabel,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      style={{
        background: "none",
        border: "none",
        color: disabled ? "var(--text-dim)" : "var(--text-muted)",
        cursor: disabled ? "default" : "pointer",
        fontSize: 11,
        padding: "2px 6px",
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
