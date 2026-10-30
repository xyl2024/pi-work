"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as echarts from "echarts";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { readThemeBg } from "@/components/renderers/EchartsBlock";

let libPromise: Promise<typeof echarts> | null = null;
function loadLib(): Promise<typeof echarts> {
  if (!libPromise) libPromise = import("echarts");
  return libPromise;
}

interface Props {
  option: echarts.EChartsCoreOption;
  height: number | string;
  ariaLabel?: string;
}

export function EchartsChart({ option, height, ariaLabel }: Props) {
  const { t } = useI18n();
  const { preset, isDark } = useTheme();
  const [lib, setLib] = useState<typeof echarts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLib()
      .then((m) => {
        if (!cancelled) setLib(m);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bg = useMemo(() => readThemeBg(isDark), [isDark]);
  useEffect(() => {
    setRenderError(null);
    if (!lib || !containerRef.current) return;
    const el = containerRef.current;
    const chart = lib.init(el, isDark ? "dark" : undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [lib, isDark, preset]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const merged: echarts.EChartsCoreOption = {
        backgroundColor: bg,
        ...option,
      };
      chart.setOption(merged, { replaceMerge: ["graphic"] });
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : String(e));
    }
  }, [option, bg, preset]);

  const error = loadError ?? renderError;

  return (
    <div>
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height }}
      />
      {error && (
        <div
          style={{
            fontSize: 11,
            color: "#f87171",
            padding: "4px 8px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontFamily: "var(--font-mono-stack)",
          }}
        >
          {t("Failed to render ECharts chart")} — {error}
        </div>
      )}
    </div>
  );
}
