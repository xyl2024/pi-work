"use client";

import { useCallback, useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { copyText } from "@/lib/client/clipboard";
import { FullscreenOverlay } from "@/components/ui/FullscreenOverlay";

interface Props {
  code: string;
  isStreaming?: boolean;
}

const SVG_TAG_RE = /<svg[\s>]/i;

export function SvgBlock({ code, isStreaming }: Props) {
  const { t } = useI18n();
  const [copied, flashCopied] = useTransientFlag();
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const [expanded, setExpanded] = useState(false);

  const { svg, error } = useMemo<{ svg: string | null; error: string | null }>(() => {
    try {
      const cleaned = DOMPurify.sanitize(code, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      if (!cleaned || !SVG_TAG_RE.test(cleaned)) {
        return { svg: null, error: null };
      }
      return { svg: cleaned, error: null };
    } catch (e) {
      return { svg: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const onCopy = useCallback(() => {
    void copyText(code).then(() => {
      flashCopied();
    });
  }, [code, flashCopied]);

  const onDownload = useCallback(() => {
    if (!svg) return;
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', svg],
      { type: "image/svg+xml;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "image.svg";
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
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ maxWidth: "100%" }}
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
        fontFamily: "var(--font-mono)",
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
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <Header
        onExpand={() => setExpanded(true)}
        canExpand={!!svg}
        onDownload={onDownload}
        onCopy={onCopy}
        copied={copied}
        viewMode={viewMode}
        canRender={!!svg}
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
          {t("Failed to render SVG")} — {error}
        </div>
      )}
      {expanded && (
        <FullscreenOverlay
          onClose={() => setExpanded(false)}
          header={<span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>svg</span>}
        >
          {showRendered ? (
            <div
              style={{
                width: "100%",
                height: "100%",
                overflow: "auto",
                padding: 24,
                boxSizing: "border-box",
                background: "var(--bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: svg }}
                style={{ maxWidth: "100%", minWidth: "min-content" }}
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
  onExpand,
  canExpand,
  onDownload,
  onCopy,
  copied,
  viewMode,
  canRender,
  onToggleView,
}: {
  onExpand: () => void;
  canExpand: boolean;
  onDownload: () => void;
  onCopy: () => void;
  copied: boolean;
  viewMode: "rendered" | "source";
  canRender: boolean;
  onToggleView: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: "3px 10px",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-dim)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span>svg</span>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
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
          disabled={!canRender}
          ariaLabel={viewMode === "source" ? t("View diagram") : t("View source")}
          title={viewMode === "source" ? t("View diagram") : t("View source")}
        >
          {"</>"}
        </HeaderButton>
        <HeaderButton
          onClick={onDownload}
          disabled={!canRender}
          ariaLabel={t("Download SVG")}
          title={t("Download SVG")}
        >
          ↓
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
        borderRadius: 3,
        fontFamily: "var(--font-mono)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
