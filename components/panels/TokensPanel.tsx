"use client";

/**
 * Token audit panel — a small dashboard for `~/.pi-work/token-audit.db`.
 *
 * Fetches three parallel JSON snapshots from `/api/token-audit/summary` and
 * lays them out as a KPI strip + a 2-column ECharts grid. The `EchartsChart`
 * wrapper handles the dynamic import, dark-mode theme, and dispose/re-init
 * on option identity change, so each chart below is just a `useMemo` of an
 * `EChartsCoreOption`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type * as echarts from "echarts";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useToast } from "../ui/Toast";
import { EchartsChart } from "../files/EchartsChart";
import { useTheme } from "@/hooks/useTheme";
import type {
  Range,
  SummaryBucket,
  SummarizeResult,
} from "@/lib/shared/token-audit-types";

const RANGES: Range[] = ["today", "7d", "30d", "all"];

// ── formatters ────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmtHour(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function fmtMonthDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDayKey(key: string): number | null {
  // "YYYY-MM-DD" -> local midnight epoch-ms
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0).getTime();
}

// ── time-bucket zero-padding ──────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Fill gaps in a `SummaryBucket[]` keyed by YYYY-MM-DD between [from, to]. */
function zeroPadDaySeries(fromTs: number, toTs: number, raw: SummaryBucket[]): SummaryBucket[] {
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs < fromTs) return [];
  const byTs = new Map<number, SummaryBucket>();
  for (const b of raw) {
    const ts = fmtDayKey(b.key);
    if (ts !== null) byTs.set(ts, b);
  }
  const start = new Date(fromTs);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const out: SummaryBucket[] = [];
  for (let t = startMs; t <= toTs; t += DAY_MS) {
    const hit = byTs.get(t);
    if (hit) {
      out.push(hit);
    } else {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({
        key,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costTotal: 0,
        durationMs: 0,
        firstAt: 0,
        lastAt: 0,
      });
    }
  }
  return out;
}

// ── shared echarts palette + style ────────────────────────────────────────

// ECharts default categorical palette — high contrast in both light & dark themes.
const PALETTE = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
];

function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

// ECharts axis/tooltip labels adopt the surrounding theme via a tiny inline
// helper that reads CSS vars on the root. Memoized per theme so option identity
// is stable across re-renders that don't change preset/isDark.
function useChartTheme() {
  const { preset, isDark } = useTheme();
  return useMemo(() => {
    void preset;
    if (typeof document === "undefined") {
      return isDark
        ? { text: "#d4d4d4", axis: "#666", tooltipBg: "rgba(40,40,40,0.92)" }
        : { text: "#333", axis: "#bbb", tooltipBg: "rgba(255,255,255,0.95)" };
    }
    const cs = getComputedStyle(document.documentElement);
    const text = cs.getPropertyValue("--text").trim() || (isDark ? "#d4d4d4" : "#333");
    const axis = cs.getPropertyValue("--border").trim() || (isDark ? "#666" : "#ddd");
    const tooltipBg = isDark ? "rgba(40,40,40,0.92)" : "rgba(255,255,255,0.96)";
    return { text, axis, tooltipBg };
  }, [preset, isDark]);
}

// ── main component ────────────────────────────────────────────────────────

interface FetchState {
  time: SummarizeResult | null;
  model: SummarizeResult | null;
  session: SummarizeResult | null;
  /** sessionId → human-readable name (only sessions that have a non-empty
   *  `session_info` entry are mapped; everything else falls back to id). */
  sessionNames: Map<string, string>;
}

export function TokensPanel() {
  const { t } = useI18n();
  const toast = useToast();

  const [range, setRange] = useState<Range>("7d");
  const [state, setState] = useState<FetchState>({
    time: null,
    model: null,
    session: null,
    sessionNames: new Map(),
  });

  const timeGroupBy: "hour" | "day" = range === "today" ? "hour" : "day";

  const reload = useCallback(async () => {
    try {
      const [timeRes, modelRes, sessionRes, sessionsRes] = await Promise.all([
        fetch(`/api/token-audit/summary?range=${range}&groupBy=${timeGroupBy}`),
        fetch(`/api/token-audit/summary?range=${range}&groupBy=model`),
        fetch(`/api/token-audit/summary?range=${range}&groupBy=session`),
        // Large limit so the map covers every session that could appear in
        // the Top-sessions chart. The list endpoint already caches for 5s.
        fetch(`/api/sessions?limit=10000`),
      ]);
      if (!timeRes.ok || !modelRes.ok || !sessionRes.ok || !sessionsRes.ok) {
        throw new Error(`HTTP ${timeRes.status}/${modelRes.status}/${sessionRes.status}/${sessionsRes.status}`);
      }
      const [time, model, session, sessionsData] = (await Promise.all([
        timeRes.json(),
        modelRes.json(),
        sessionRes.json(),
        sessionsRes.json(),
      ])) as [SummarizeResult, SummarizeResult, SummarizeResult, { sessions?: Array<{ id: string; name?: string }> }];
      const sessionNames = new Map<string, string>();
      for (const s of sessionsData.sessions ?? []) {
        if (s.name && s.name.trim()) sessionNames.set(s.id, s.name);
      }
      setState({ time, model, session, sessionNames });
    } catch (e) {
      toast.show({ kind: "error", message: `${t("Failed to load token audit")}: ${String(e)}` });
    }
    // timeGroupBy is derived in render from range; range triggers the refetch.
  }, [range, timeGroupBy, toast, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totals = state.time?.totals;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <Toolbar
        range={range}
        onChangeRange={setRange}
      />
      <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <KpiStrip totals={totals} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 12,
          }}
        >
          <ChartCard title={t("Cost over time")}>
            <CostOverTimeChart range={range} buckets={state.time?.buckets ?? []} />
          </ChartCard>
          <ChartCard title={t("Token composition")}>
            <TokenCompositionChart range={range} buckets={state.time?.buckets ?? []} />
          </ChartCard>
          <ChartCard title={t("Cost by model")}>
            <CostByCategoryChart
              buckets={state.model?.buckets ?? []}
              totalCost={state.model?.totals.costTotal ?? 0}
              labelKey={(b) => b.key}
              unknownLabel={t("Unknown")}
            />
          </ChartCard>
          <ChartCard title={t("Cost by provider")}>
            <CostByCategoryChart
              buckets={groupByProvider(state.model?.buckets ?? [])}
              totalCost={state.model?.totals.costTotal ?? 0}
              labelKey={(b) => b.key}
              unknownLabel={t("Unknown")}
            />
          </ChartCard>
          <ChartCard title={t("Cache hit rate")}>
            <CacheHitRateChart range={range} buckets={state.time?.buckets ?? []} />
          </ChartCard>
          <ChartCard title={t("Top sessions by cost")}>
            <TopSessionsChart buckets={state.session?.buckets.slice(0, 10) ?? []} sessionNames={state.sessionNames} />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

/** The model key is "provider/model_id". Aggregate by provider. */
function groupByProvider(buckets: SummaryBucket[]): SummaryBucket[] {
  const byProv = new Map<string, SummaryBucket>();
  for (const b of buckets) {
    const slash = b.key.indexOf("/");
    const prov = slash >= 0 ? b.key.slice(0, slash) : b.key;
    const prev = byProv.get(prov);
    if (prev) {
      prev.calls += b.calls;
      prev.inputTokens += b.inputTokens;
      prev.outputTokens += b.outputTokens;
      prev.cacheReadTokens += b.cacheReadTokens;
      prev.cacheWriteTokens += b.cacheWriteTokens;
      prev.costTotal += b.costTotal;
      prev.durationMs += b.durationMs;
      if (b.firstAt && (!prev.firstAt || b.firstAt < prev.firstAt)) prev.firstAt = b.firstAt;
      if (b.lastAt && b.lastAt > prev.lastAt) prev.lastAt = b.lastAt;
    } else {
      byProv.set(prov, { ...b, key: prov });
    }
  }
  const out = Array.from(byProv.values());
  out.sort((a, b) => b.costTotal - a.costTotal);
  return out;
}

// ── toolbar ───────────────────────────────────────────────────────────────

interface ToolbarProps {
  range: Range;
  onChangeRange: (r: Range) => void;
}

function Toolbar({ range, onChangeRange }: ToolbarProps) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        flexWrap: "wrap",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginRight: 4 }}>
        {t("Token audit")}
      </span>
      {RANGES.map((r) => (
        <ChipButton key={r} active={range === r} onClick={() => onChangeRange(r)} label={rangeLabel(r, t)} />
      ))}
    </div>
  );
}

function rangeLabel(r: Range, t: (k: string) => string): string {
  if (r === "today") return t("Today");
  if (r === "7d") return t("Last 7 days");
  if (r === "30d") return t("Last 30 days");
  return t("All time");
}

// ── KPI strip ─────────────────────────────────────────────────────────────

interface KpiStripProps {
  totals: SummaryBucket | undefined;
}

function KpiStrip({ totals }: KpiStripProps) {
  const { t } = useI18n();
  const { formatCost } = useFormatCurrency();
  if (!totals) {
    return (
      <div style={kpiGridStyle}>
        {[0, 1, 2, 3, 4].map((i) => (
          <KpiCard key={i} label={i === 0 ? t("Total cost") : i === 1 ? t("Calls") : i === 2 ? t("Total tokens") : i === 3 ? t("Avg duration") : t("Cache hit rate")} value="—" />
        ))}
      </div>
    );
  }
  const totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const hitDenom = totals.inputTokens + totals.cacheReadTokens;
  const hitRate = hitDenom > 0 ? totals.cacheReadTokens / hitDenom : null;
  const avgMs = totals.calls > 0 ? totals.durationMs / totals.calls : 0;
  return (
    <div style={kpiGridStyle}>
      <KpiCard label={t("Total cost")} value={formatCost(totals.costTotal)} accent />
      <KpiCard label={t("Calls")} value={fmtNum(totals.calls)} sub={totals.calls > 0 ? `${totals.calls} ${t("audit")}` : undefined} />
      <KpiCard label={t("Total tokens")} value={fmtNum(totalTokens)} sub={t("incl. cache")} />
      <KpiCard label={t("Avg duration")} value={avgMs > 0 ? `${(avgMs / 1000).toFixed(1)}s` : "—"} />
      <KpiCard label={t("Cache hit rate")} value={hitRate === null ? "—" : fmtPct(hitRate)} sub={hitRate !== null ? fmtNum(totals.cacheReadTokens) : undefined} />
    </div>
  );
}

const kpiGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8,
};

function KpiCard({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const color = warn ? "#f87171" : accent ? "var(--accent)" : "var(--text)";
  return (
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 64,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 600, color, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>{value}</span>
      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{label}</span>
      {sub && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{sub}</span>}
    </div>
  );
}

// ── chart card wrapper ────────────────────────────────────────────────────

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.2 }}>{title}</div>
      {children}
    </div>
  );
}

// ── charts ────────────────────────────────────────────────────────────────

/** Pad a series to align the chart x-axis to the range. */
function padTimeBuckets(range: Range, raw: SummaryBucket[]): { ts: number; b: SummaryBucket }[] {
  if (range === "today") {
    // Hour-of-day buckets are local time; the SQLite key is "YYYY-MM-DD HH:00".
    // We don't have a tsMs field here so parse from the key.
    const parsed = raw
      .map((b) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(b.key);
        if (!m) return null;
        const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0).getTime();
        return { ts, b };
      })
      .filter((x): x is { ts: number; b: SummaryBucket } => x !== null);
    parsed.sort((a, b) => a.ts - b.ts);
    return parsed;
  }
  const parsed = raw
    .map((b) => {
      const ts = fmtDayKey(b.key);
      if (ts === null) return null;
      return { ts, b };
    })
    .filter((x): x is { ts: number; b: SummaryBucket } => x !== null);
  parsed.sort((a, b) => a.ts - b.ts);
  // Fill missing days in the visible window.
  const now = Date.now();
  let fromTs: number;
  if (range === "7d") fromTs = now - 7 * DAY_MS;
  else if (range === "30d") fromTs = now - 30 * DAY_MS;
  else {
    if (parsed.length === 0) return [];
    fromTs = parsed[0].ts;
  }
  return zeroPadDaySeries(fromTs, now, raw).map((b) => {
    const ts = fmtDayKey(b.key) ?? 0;
    return { ts, b };
  });
}

function CostOverTimeChart({ range, buckets }: { range: Range; buckets: SummaryBucket[] }) {
  const { t } = useI18n();
  const theme = useChartTheme();
  const { formatCost } = useFormatCurrency();
  const series = useMemo(() => padTimeBuckets(range, buckets), [range, buckets]);
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    const xs = series.map((p) => (range === "today" ? fmtHour(p.ts) : fmtMonthDay(p.ts)));
    const costs = series.map((p) => +p.b.costTotal.toFixed(4));
    const calls = series.map((p) => p.b.calls);
    return {
      animation: false,
      grid: { left: 50, right: 50, top: 18, bottom: 22 },
      tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, borderColor: theme.axis, textStyle: { color: theme.text, fontSize: 11 } },
      xAxis: {
        type: "category",
        data: xs,
        axisLine: { lineStyle: { color: theme.axis } },
        axisLabel: { color: theme.text, fontSize: 10, fontFamily: "var(--font-mono)", interval: range === "today" ? 2 : "auto" },
      },
      yAxis: [
        {
          type: "value",
          name: t("Cost"),
          nameTextStyle: { color: theme.text, fontSize: 10 },
          axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => formatCost(v) },
          splitLine: { lineStyle: { color: theme.axis, type: "dashed", opacity: 0.4 } },
        },
        {
          type: "value",
          name: t("Calls"),
          nameTextStyle: { color: theme.text, fontSize: 10 },
          axisLabel: { color: theme.text, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: t("Cost"),
          type: "line",
          data: costs,
          smooth: true,
          symbol: "circle",
          symbolSize: 4,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.18 },
          color: PALETTE[0],
        },
        {
          name: t("Calls"),
          type: "bar",
          yAxisIndex: 1,
          data: calls,
          barWidth: "40%",
          itemStyle: { color: PALETTE[1], opacity: 0.55 },
        },
      ],
    };
  }, [series, theme, t, range, formatCost]);
  return <EchartsChart option={option} height={220} ariaLabel={t("Cost over time")} />;
}

function TokenCompositionChart({ range, buckets }: { range: Range; buckets: SummaryBucket[] }) {
  const { t } = useI18n();
  const theme = useChartTheme();
  const series = useMemo(() => padTimeBuckets(range, buckets), [range, buckets]);
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    const xs = series.map((p) => (range === "today" ? fmtHour(p.ts) : fmtMonthDay(p.ts)));
    return {
      animation: false,
      grid: { left: 50, right: 14, top: 18, bottom: 22 },
      tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, borderColor: theme.axis, textStyle: { color: theme.text, fontSize: 11 } },
      legend: { textStyle: { color: theme.text, fontSize: 10 }, top: 0, right: 0, itemWidth: 10, itemHeight: 10 },
      xAxis: {
        type: "category",
        data: xs,
        axisLine: { lineStyle: { color: theme.axis } },
        axisLabel: { color: theme.text, fontSize: 10, fontFamily: "var(--font-mono)", interval: range === "today" ? 2 : "auto" },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => fmtNum(v) },
        splitLine: { lineStyle: { color: theme.axis, type: "dashed", opacity: 0.4 } },
      },
      series: [
        { name: t("Cache write"), type: "line", stack: "tokens", smooth: true, areaStyle: {}, symbol: "none", data: series.map((p) => p.b.cacheWriteTokens), color: PALETTE[7] },
        { name: t("Cache read"), type: "line", stack: "tokens", smooth: true, areaStyle: {}, symbol: "none", data: series.map((p) => p.b.cacheReadTokens), color: PALETTE[1] },
        { name: t("Input tokens"), type: "line", stack: "tokens", smooth: true, areaStyle: {}, symbol: "none", data: series.map((p) => p.b.inputTokens), color: PALETTE[0] },
        { name: t("Output tokens"), type: "line", stack: "tokens", smooth: true, areaStyle: {}, symbol: "none", data: series.map((p) => p.b.outputTokens), color: PALETTE[3] },
      ],
    };
  }, [series, theme, t, range]);
  return <EchartsChart option={option} height={220} ariaLabel={t("Token composition")} />;
}

function CostByCategoryChart({
  buckets,
  totalCost,
  labelKey,
  unknownLabel,
}: {
  buckets: SummaryBucket[];
  totalCost: number;
  labelKey: (b: SummaryBucket) => string;
  unknownLabel: string;
}) {
  const { t } = useI18n();
  const theme = useChartTheme();
  const { formatCost } = useFormatCurrency();
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    if (buckets.length === 0) {
      return emptyDonut(theme, totalCost, formatCost);
    }
    const top = buckets.slice(0, 6);
    const rest = buckets.slice(6);
    const restCost = rest.reduce((s, b) => s + b.costTotal, 0);
    const data = top.map((b, i) => ({
      name: shortLabel(labelKey(b)),
      value: +b.costTotal.toFixed(4),
      itemStyle: { color: paletteColor(i) },
    }));
    if (rest.length > 0) {
      data.push({ name: unknownLabel, value: +restCost.toFixed(4), itemStyle: { color: "#888" } });
    }
    return {
      animation: false,
      tooltip: { trigger: "item", backgroundColor: theme.tooltipBg, borderColor: theme.axis, textStyle: { color: theme.text, fontSize: 11 }, formatter: ((p: unknown): string => {
          const pp = p as { marker?: string; name?: string; value?: number; percent?: number };
          return `${pp.marker ?? ""} ${pp.name ?? ""}<br/>${formatCost(pp.value ?? 0)} (${pp.percent ?? 0}%)`;
        }) as never },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 4,
        top: "middle",
        textStyle: { color: theme.text, fontSize: 10 },
        itemWidth: 10,
        itemHeight: 10,
        formatter: (name: string) => truncate(name, 22),
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "78%"],
          center: ["38%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: theme.tooltipBg, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          data,
        },
      ],
      graphic: [
        {
          type: "text",
          left: "38%",
          top: "46%",
          style: { text: formatCost(totalCost), fill: theme.text, fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", textAlign: "center" },
        },
        {
          type: "text",
          left: "38%",
          top: "60%",
          style: { text: t("Total cost"), fill: theme.text, fontSize: 10, textAlign: "center" },
        },
      ],
    };
  }, [buckets, totalCost, theme, labelKey, t, unknownLabel, formatCost]);
  return <EchartsChart option={option} height={260} ariaLabel={t("Cost by category")} />;
}

function CacheHitRateChart({ range, buckets }: { range: Range; buckets: SummaryBucket[] }) {
  const { t } = useI18n();
  const theme = useChartTheme();
  const series = useMemo(() => padTimeBuckets(range, buckets), [range, buckets]);
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    const xs = series.map((p) => (range === "today" ? fmtHour(p.ts) : fmtMonthDay(p.ts)));
    const rates = series.map((p) => {
      const denom = p.b.inputTokens + p.b.cacheReadTokens;
      if (denom === 0) return null;
      return +(p.b.cacheReadTokens / denom * 100).toFixed(1);
    });
    return {
      animation: false,
      grid: { left: 50, right: 14, top: 18, bottom: 22 },
      tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, borderColor: theme.axis, textStyle: { color: theme.text, fontSize: 11 }, valueFormatter: ((v: unknown) => (v == null ? "—" : `${v}%`)) as never },
      xAxis: {
        type: "category",
        data: xs,
        axisLine: { lineStyle: { color: theme.axis } },
        axisLabel: { color: theme.text, fontSize: 10, fontFamily: "var(--font-mono)", interval: range === "today" ? 2 : "auto" },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: theme.axis, type: "dashed", opacity: 0.4 } },
      },
      series: [
        {
          type: "line",
          data: rates,
          smooth: true,
          symbol: "circle",
          symbolSize: 4,
          connectNulls: true,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.18 },
          color: PALETTE[2],
        },
      ],
    };
  }, [series, theme, range]);
  return <EchartsChart option={option} height={220} ariaLabel={t("Cache hit rate")} />;
}

function TopSessionsChart({ buckets, sessionNames }: { buckets: SummaryBucket[]; sessionNames: Map<string, string> }) {
  const { t } = useI18n();
  const theme = useChartTheme();
  const { formatCost } = useFormatCurrency();
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    if (buckets.length === 0) return emptyBars(theme, t("No token usage recorded yet."));
    const sorted = [...buckets].sort((a, b) => b.costTotal - a.costTotal);
    // Prefer the human-readable session name (set via /rename or auto-name);
    // fall back to the sessionId for never-renamed sessions or when the
    // /api/sessions fetch failed before this map was populated.
    const displayName = (id: string): string => {
      const n = sessionNames.get(id);
      return n && n.trim() ? n : id;
    };
    return {
      animation: false,
      grid: { left: 12, right: 60, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: theme.tooltipBg, borderColor: theme.axis, textStyle: { color: theme.text, fontSize: 11 }, formatter: ((params: unknown): string => {
        const arr = Array.isArray(params) ? params : [params];
        const p = arr[0] as { name?: string; value?: number };
        return `<div style="font-family:var(--font-mono);font-size:11px">${shortLabel(p.name ?? "")}<br/>${formatCost(p.value ?? 0)}</div>`;
      }) as never },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => formatCost(v) },
        splitLine: { lineStyle: { color: theme.axis, type: "dashed", opacity: 0.4 } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((b) => shortLabel(displayName(b.key), 18)).reverse(),
        axisLine: { lineStyle: { color: theme.axis } },
        axisLabel: { color: theme.text, fontSize: 10, fontFamily: "var(--font-mono)" },
      },
      series: [
        {
          type: "bar",
          data: sorted.map((b, i) => ({ value: +b.costTotal.toFixed(4), itemStyle: { color: paletteColor(i) } })).reverse(),
          barWidth: "60%",
        },
      ],
    };
  }, [buckets, theme, t, formatCost, sessionNames]);
  return <EchartsChart option={option} height={260} ariaLabel={t("Top sessions by cost")} />;
}

// ── atoms ─────────────────────────────────────────────────────────────────

function ChipButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--bg-selected)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        transition: "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}

// ── shared helpers ────────────────────────────────────────────────────────

function shortLabel(s: string, max = 32): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function emptyDonut(theme: ReturnType<typeof useChartTheme>, totalCost: number, formatCost: (usd: number) => string): echarts.EChartsCoreOption {
  return {
    animation: false,
    series: [
      {
        type: "pie",
        radius: ["52%", "78%"],
        center: ["38%", "50%"],
        itemStyle: { color: theme.axis },
        label: { show: false },
        data: [{ name: "—", value: 1 }],
      },
    ],
    graphic: [
      { type: "text", left: "38%", top: "46%", style: { text: formatCost(totalCost), fill: theme.text, fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", textAlign: "center" } },
      { type: "text", left: "38%", top: "60%", style: { text: "—", fill: theme.text, fontSize: 10, textAlign: "center" } },
    ],
  };
}

function emptyBars(theme: ReturnType<typeof useChartTheme>, message: string): echarts.EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 12, right: 60, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: [], axisLabel: { color: theme.text } },
    series: [{ type: "bar", data: [] }],
    graphic: [{ type: "text", left: "center", top: "middle", style: { text: message, fill: theme.text, fontSize: 11, fontStyle: "italic", textAlign: "center" } }],
  };
}