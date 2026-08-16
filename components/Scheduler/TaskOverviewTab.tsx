/**
 * TaskOverviewTab — at-a-glance stats + metadata for one scheduled task.
 *
 * Four KPI cards at the top (total / success rate / avg duration / failures),
 * then a metadata block listing the task's identity fields. Stats are
 * computed locally from the loaded `runs` list — no extra request — so
 * updating them is free as soon as the runs tab fetches.
 */

import type { CSSProperties } from "react";
import { StatusBadge } from "./StatusBadge";
import { CronHumanizer } from "./CronHumanizer";
import { useNow } from "./useNow";
import { computeStats, formatDuration, formatRelative } from "./utils";
import type { ScheduledTask, TaskRun } from "./types";

interface Props {
  task: ScheduledTask;
  runs: TaskRun[];
}

export function TaskOverviewTab({ task, runs }: Props) {
  const stats = computeStats(runs);
  const now = useNow(30_000);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard label="总运行" value={stats.total.toString()} hint={`${stats.success} 成功`} tone="muted" />
        <KpiCard
          label="成功率"
          value={stats.total === 0 ? "—" : `${Math.round(stats.successRate * 100)}%`}
          hint={stats.total === 0 ? "暂无数据" : `${stats.failed} 失败`}
          tone={stats.successRate >= 0.9 ? "success" : stats.successRate >= 0.5 ? "warning" : "error"}
        />
        <KpiCard
          label="平均耗时"
          value={formatDuration(stats.avgDurationMs) ?? "—"}
          hint={stats.avgDurationMs === null ? "暂无数据" : `基于 ${runs.filter((r) => r.durationMs !== null).length} 次`}
          tone="muted"
        />
        <KpiCard
          label="失败次数"
          value={stats.failed.toString()}
          hint={stats.timedOut > 0 ? `${stats.timedOut} 次超时` : "包含错误和超时"}
          tone={stats.failed === 0 ? "muted" : stats.failed > 3 ? "error" : "warning"}
        />
      </div>

      {/* Identity metadata */}
      <section>
        <SectionTitle>基础信息</SectionTitle>
        <dl style={dlStyle}>
          <Row label="Cron 表达式">
            <CronHumanizer cron={task.cron} previewCount={5} showCode />
          </Row>
          <Row label="下次运行">
            {task.enabled
              ? task.nextRunAt ? formatRelative(now, task.nextRunAt) : "—"
              : "已暂停,不会触发"}
          </Row>
          <Row label="上次运行">
            {task.lastRunAt
              ? <><span style={{ marginRight: 6 }}>{formatRelative(now, task.lastRunAt)}</span>{task.lastRunStatus && <StatusBadge status={task.lastRunStatus} size="sm" />}</>
              : "从未运行"}
          </Row>
          <Row label="工作目录">
            <code style={monoStyle}>{task.cwd}</code>
          </Row>
          <Row label="创建于">{new Date(task.createdAt).toLocaleString()}</Row>
          <Row label="修改于">{new Date(task.updatedAt).toLocaleString()}</Row>
        </dl>
      </section>

      {/* Execution metadata */}
      <section>
        <SectionTitle>执行配置</SectionTitle>
        <dl style={dlStyle}>
          <Row label="Provider">
            {task.provider ? <code style={monoStyle}>{task.provider}</code> : <span style={{ color: "var(--text-muted)" }}>使用默认</span>}
          </Row>
          <Row label="模型">
            {task.modelId ? <code style={monoStyle}>{task.modelId}</code> : <span style={{ color: "var(--text-muted)" }}>使用默认</span>}
          </Row>
          <Row label="推理强度">
            {task.thinkingLevel ?? <span style={{ color: "var(--text-muted)" }}>默认</span>}
          </Row>
          <Row label="工具">
            {task.toolNames === null
              ? "全部"
              : task.toolNames.length === 0
                ? "无"
                : task.toolNames.join(", ")}
          </Row>
        </dl>
      </section>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

const kpiToneColor: Record<"muted" | "success" | "warning" | "error", string> = {
  muted: "var(--text)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
};

function KpiCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "muted" | "success" | "warning" | "error" }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: kpiToneColor[tone], fontFamily: "var(--font-mono)" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

const dlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "110px 1fr",
  gap: "6px 12px",
  fontSize: 12,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--text-muted)", paddingTop: 1 }}>{label}</dt>
      <dd style={{ margin: 0, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {children}
      </dd>
    </>
  );
}

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "1px 5px",
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  color: "var(--text)",
};