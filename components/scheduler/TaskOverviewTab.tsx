/**
 * TaskOverviewTab — at-a-glance stats + metadata for one scheduled task.
 *
 * Four KPI cards at the top (total / success rate / avg duration / failures),
 * then a metadata block listing the task's identity fields. Stats are
 * computed locally from the loaded `runs` list — no extra request — so
 * updating them is free as soon as the runs tab fetches.
 */

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
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
  const { t, locale } = useI18n();
  const stats = computeStats(runs);
  const now = useNow(30_000);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard label={t("Total runs")} value={stats.total.toString()} hint={t("{n} succeeded", { n: stats.success })} tone="muted" />
        <KpiCard
          label={t("Success rate")}
          value={stats.total === 0 ? "—" : `${Math.round(stats.successRate * 100)}%`}
          hint={stats.total === 0 ? t("No data") : t("{n} failed", { n: stats.failed })}
          tone={stats.successRate >= 0.9 ? "success" : stats.successRate >= 0.5 ? "warning" : "error"}
        />
        <KpiCard
          label={t("Avg duration")}
          value={formatDuration(stats.avgDurationMs) ?? "—"}
          hint={stats.avgDurationMs === null ? t("No data") : t("Based on {n} runs", { n: runs.filter((r) => r.durationMs !== null).length })}
          tone="muted"
        />
        <KpiCard
          label={t("Failures")}
          value={stats.failed.toString()}
          hint={stats.timedOut > 0 ? t("{n} timed out", { n: stats.timedOut }) : stats.interrupted > 0 ? t("{n} interrupted", { n: stats.interrupted }) : t("Includes errors, timeouts and interruptions")}
          tone={stats.failed === 0 ? "muted" : stats.failed > 3 ? "error" : "warning"}
        />
      </div>

      {/* Identity metadata */}
      <section>
        <SectionTitle>{t("Basic info")}</SectionTitle>
        <dl style={dlStyle}>
          <Row label={t("Cron expression")}>
            <CronHumanizer cron={task.cron} previewCount={5} showCode />
          </Row>
          <Row label={t("Next run")}>
            {task.enabled
              ? task.nextRunAt ? formatRelative(now, task.nextRunAt, locale) : "—"
              : t("Paused, will not trigger")}
          </Row>
          <Row label={t("Last run")}>
            {task.lastRunAt
              ? <><span style={{ marginRight: 6 }}>{formatRelative(now, task.lastRunAt, locale)}</span>{task.lastRunStatus && <StatusBadge status={task.lastRunStatus} size="sm" />}</>
              : t("Never run")}
          </Row>
          <Row label={t("Working directory")}>
            <code style={monoStyle}>{task.cwd}</code>
          </Row>
          <Row label={t("Created at")}>{new Date(task.createdAt).toLocaleString()}</Row>
          <Row label={t("Updated at")}>{new Date(task.updatedAt).toLocaleString()}</Row>
        </dl>
      </section>

      {/* Execution metadata */}
      <section>
        <SectionTitle>{t("Execution config")}</SectionTitle>
        <dl style={dlStyle}>
          <Row label="Provider">
            {task.provider ? <code style={monoStyle}>{task.provider}</code> : <Missing>{t("Not set")}</Missing>}
          </Row>
          <Row label={t("Model")}>
            {task.modelId ? <code style={monoStyle}>{task.modelId}</code> : <Missing>{t("Not set")}</Missing>}
          </Row>
          <Row label={t("Thinking level")}>
            {task.thinkingLevel && task.thinkingLevel !== "auto" ? task.thinkingLevel : <Missing>{t("Not set")}</Missing>}
          </Row>
          <Row label={t("Tools")}>
            {task.toolNames === null
              ? t("All")
              : task.toolNames.length === 0
                ? t("No tools")
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

// `Provider` / `Model` / `Thinking level` are all required on scheduled tasks.
// A missing or "auto" value means an old task needs re-picking — surface that
// as an obvious error-tinted "Not set" so the user can see at a glance that
// the task has dangling required fields.
function Missing({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--error)", fontSize: 11 }}>{children}</span>;
}