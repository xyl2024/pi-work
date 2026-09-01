"use client";

/**
 * Reusable ECharts renderer for dashboard panels.
 *
 * Differs from `EchartsBlock` (which renders ```echarts fenced code blocks in
 * markdown by `eval`ing the JS body): this component takes a fully-typed
 * `EChartsCoreOption` object built by the caller. Both are themed via
 * `useTheme()` and dispose + re-init on `preset`/`isDark` change so the new
 * theme registers correctly at `init` time.
 *
 * Option updates use setOption so transient ECharts interaction state (such as
 * tooltip and legend selection) survives ordinary React re-renders. The chart
 * is only re-initialized when its theme changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type * as echarts from "echarts";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { readThemeBg } from "@/components/renderers/EchartsBlock";

// Dynamic import keeps echarts (~MB) out of the initial bundle. The promise is
// memoized at module scope so successive charts reuse the same load — this is
// the same pattern used by EchartsBlock; we intentionally keep them independent
// (webpack already module-caches the network fetch, so this is just an await
// cache, no extra round-trip).
let libPromise: Promise<typeof echarts> | null = null;
function loadLib(): Promise<typeof echarts> {
  if (!libPromise) libPromise = import("echarts");
  return libPromise;
}

interface Props {
  option: echarts.EChartsCoreOption;
  /** Container height — number (px) or any CSS length string. */
  height: number | string;
  /** Accessibility label for the chart container. */
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

  // One-time module load.
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

  // ECharts binds its theme at init time, so a theme switch needs dispose +
  // re-init. Do not include `option` here: disposing the instance on every
  // React render loses tooltip state and resets legend selections.
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

  // Update data/config in place. ECharts preserves interaction state across
  // setOption calls, including the legend's selected map and active tooltip.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const merged: echarts.EChartsCoreOption = {
        backgroundColor: bg,
        ...option,
      };
      // Replace graphic elements because the count can change between options;
      // ordinary option merging would otherwise retain stale text nodes.
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
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("Failed to render ECharts chart")} — {error}
        </div>
      )}
    </div>
  );
}
