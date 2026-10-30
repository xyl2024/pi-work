"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as echarts from "echarts";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { copyText } from "@/lib/client/clipboard";
import { FullscreenOverlay } from "@/components/ui/FullscreenOverlay";

let libPromise: Promise<typeof echarts> | null = null;
function loadLib(): Promise<typeof echarts> {
  if (!libPromise) libPromise = import("echarts");
  return libPromise;
}

export function readThemeBg(isDark: boolean): string {
  if (typeof document === "undefined") return isDark ? "#1a1a1a" : "#ffffff";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return v || (isDark ? "#1a1a1a" : "#ffffff");
}

async function evalOption(code: string, lib: typeof echarts): Promise<unknown> {
  try {
    return new Function("echarts", `return (${code})`)(lib);
  } catch {
  }
  return new Function(
    "echarts",
    `return (async () => { ${code}\n;return typeof option !== "undefined" ? option : undefined; })();`,
  )(lib);
}

const CHART_HEIGHT = 400;

interface Props {
  code: string;
  isStreaming?: boolean;
}

export function EchartsBlock({ code, isStreaming }: Props) {
  const { t } = useI18n();
  const { preset, isDark } = useTheme();
  const [lib, setLib] = useState<typeof echarts | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, flashCopied] = useTransientFlag();
  const [renderError, setRenderError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const [option, setOption] = useState<object | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLib().then((m) => {
      if (!cancelled) setLib(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bg = useMemo(() => readThemeBg(isDark), [isDark]);

  useEffect(() => {
    if (!lib) return;
    setOption(null);
    setEvalError(null);
    let cancelled = false;
    evalOption(code, lib)
      .then((opt) => {
        if (cancelled) return;
        if (opt && typeof opt === "object") {
          setOption(opt as object);
        } else {
          setEvalError("Evaluated value is not an ECharts option object");
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setEvalError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code, lib]);

  useEffect(() => {
    setRenderError(null);
    if (!lib || !option || viewMode !== "rendered") return;
    const el = containerRef.current;
    if (!el) return;
    const chart = lib.init(el, isDark ? "dark" : undefined, { renderer: "canvas" });
    chartRef.current = chart;
    try {
      const merged: echarts.EChartsCoreOption = {
        backgroundColor: bg,
        ...(option as echarts.EChartsCoreOption),
      };
      chart.setOption(merged);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : String(e));
    }
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [lib, option, isDark, preset, viewMode, bg]);

  const error = evalError || renderError;

  const onCopy = useCallback(() => {
    void copyText(code).then(() => {
      flashCopied();
    });
  }, [code, flashCopied]);

  const onDownload = useCallback(() => {
    if (!lib || !option) return;
    const w = containerRef.current?.clientWidth || 800;
    const off = document.createElement("div");
    off.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${CHART_HEIGHT}px`;
    document.body.appendChild(off);
    const chart = lib.init(off, isDark ? "dark" : undefined, { renderer: "canvas" });
    try {
      chart.setOption(option as echarts.EChartsCoreOption);
      const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: bg });
      const a = document.createElement("a");
      a.href = url;
      a.download = "chart.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
    } finally {
      chart.dispose();
      off.remove();
    }
  }, [lib, option, isDark, bg]);

  const showChart = viewMode === "rendered" && !!option;

  const body = showChart ? (
    <div style={{ padding: "10px 12px", background: "var(--bg)" }}>
      <div ref={containerRef} style={{ width: "100%", height: CHART_HEIGHT }} />
    </div>
  ) : viewMode === "rendered" ? (
    <div
      style={{
        height: CHART_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-dim)",
        fontSize: 12,
        fontFamily: "var(--font-mono-stack)",
        background: "var(--bg)",
      }}
    >
      {t("Rendering…")}
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
        canExpand={!!option}
        onExpand={() => setExpanded(true)}
        onDownload={onDownload}
        onCopy={onCopy}
        copied={copied}
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
          {t("Failed to render ECharts chart")} — {error}
        </div>
      )}
      {expanded && option && lib && (
        <FullscreenOverlay onClose={() => setExpanded(false)}>
          <EchartsFullscreen lib={lib} option={option} isDark={isDark} />
        </FullscreenOverlay>
      )}
    </div>
  );
}

function EchartsFullscreen({
  lib,
  option,
  isDark,
}: {
  lib: typeof echarts;
  option: object;
  isDark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { preset } = useTheme();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bg = readThemeBg(isDark);
    const chart = lib.init(el, isDark ? "dark" : undefined, { renderer: "canvas" });
    try {
      const merged: echarts.EChartsCoreOption = {
        backgroundColor: bg,
        ...(option as echarts.EChartsCoreOption),
      };
      chart.setOption(merged);
    } catch {
    }
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [lib, option, isDark, preset]);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: 24,
        boxSizing: "border-box",
        background: "var(--bg)",
      }}
    >
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

function Header({
  canExpand,
  onExpand,
  onDownload,
  onCopy,
  copied,
  viewMode,
  onToggleView,
}: {
  canExpand: boolean;
  onExpand: () => void;
  onDownload: () => void;
  onCopy: () => void;
  copied: boolean;
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
          fontFamily: "var(--font-ui-stack)",
          pointerEvents: "none",
          maxWidth: "calc(100% - 200px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        echarts
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
          ariaLabel={t("Download PNG")}
          title={t("Download PNG")}
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
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
