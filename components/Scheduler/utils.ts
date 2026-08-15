/**
 * Pure helpers for the scheduler UI: cron → natural language, relative
 * time formatting, run stats, and a thin fetch wrapper with friendly
 * errors. No React imports here — keeps it easy to unit-test in plain TS.
 */

import type { TaskRun, TaskRunStatus } from "./types";

// ── Time helpers ─────────────────────────────────────────────────

/**
 * "2 minutes ago", "in 3 hours", "just now". Falls back to the absolute
 * timestamp once the gap exceeds 7 days in either direction. Always
 * stable for a given `(now, ts)` pair so the UI doesn't flicker.
 */
export function formatRelative(now: number, ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return "—";
  const diffMs = ts - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;

  if (abs < 30_000) return past ? "刚刚" : "即将";

  const sec = Math.round(abs / 1000);
  if (sec < 60) return past ? `${sec} 秒前` : `${sec} 秒后`;

  const min = Math.round(sec / 60);
  if (min < 60) return past ? `${min} 分钟前` : `${min} 分钟后`;

  const hr = Math.round(min / 60);
  if (hr < 24) return past ? `${hr} 小时前` : `${hr} 小时后`;

  const day = Math.round(hr / 24);
  if (day < 7) return past ? `${day} 天前` : `${day} 天后`;

  return new Date(ts).toLocaleString();
}

/**
 * Compact "Next 2h14m" / "Last 3d". Used in the list rows where the full
 * "2 hours 14 minutes from now" would be too wide.
 */
export function formatCompactRelative(now: number, ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return "—";
  const diffMs = ts - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;
  if (abs < 30_000) return past ? "刚刚" : "即将";

  const min = Math.round(abs / 60_000);
  if (min < 60) return `${past ? "" : ""}${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min - hr * 60;
  if (hr < 24) return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr - day * 24;
  if (day < 7) return remHr > 0 ? `${day}d${remHr}h` : `${day}d`;
  return new Date(ts).toLocaleDateString();
}

/** "5.2s" / "1m 12s" / null. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remS = Math.round(s - m * 60);
  return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
}

// ── Cron → natural language ──────────────────────────────────────

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/**
 * Convert a 5-segment cron (minute hour day-of-month month day-of-week)
 * into a short human sentence. Best-effort: any segment we can't fully
 * describe falls back to "*" / "each". Always returns *something* — we
 * never throw on parse failures so the UI can render a row even with a
 * broken cron (the form's cron builder will show the syntax error).
 */
export function cronHumanize(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // Special: "@every minute"
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "每分钟";
  }

  // @hourly / @daily / @weekly / @monthly / @yearly
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "每小时整点";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*") return "每天 00:00";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && (dow === "1" || dow === "1-5" || dow === "MON-FRI")) {
    if (dow === "1") return "每周一";
    return "每个工作日";
  }

  // Specific minute + hour + everything wildcard  → "每天 HH:MM"
  if (isInt(min) && isInt(hour) && dom === "*" && mon === "*" && dow === "*") {
    return `每天 ${pad(hour)}:${pad(min)}`;
  }

  // "工作日 HH:MM"
  if (isInt(min) && isInt(hour) && dom === "*" && mon === "*" && dow === "1-5") {
    return `每个工作日 ${pad(hour)}:${pad(min)}`;
  }

  // "每周D HH:MM"
  if (isInt(min) && isInt(hour) && dom === "*" && mon === "*" && isInt(dow) && Number(dow) >= 0 && Number(dow) <= 6) {
    return `每${WEEKDAY_NAMES[Number(dow)]} ${pad(hour)}:${pad(min)}`;
  }

  // "每 N 分钟" — */N in minute field
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `每 ${min.slice(2)} 分钟`;
  }

  // "每 N 小时" — 0 in minute, */N in hour
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    return `每 ${hour.slice(2)} 小时`;
  }

  // Generic fallback: show raw cron in a code-like phrase
  return cron;
}

function isInt(s: string): boolean {
  return /^\d{1,2}$/.test(s);
}

function pad(s: string): string {
  return s.padStart(2, "0");
}

// ── Run stats ────────────────────────────────────────────────────

export interface TaskRunStats {
  total: number;
  success: number;
  failed: number;          // error + timeout
  timedOut: number;
  successRate: number;     // 0..1, or 0 if no completed runs
  avgDurationMs: number | null;
  lastSuccessAt: number | null;
  lastFailedAt: number | null;
}

/**
 * Compute aggregate stats from a list of runs. Used by the overview tab.
 * Treats running/in-flight runs as "in progress, not counted" — they're
 * excluded from success/failure denominators so a long-running task
 * doesn't temporarily deflate the success rate.
 */
export function computeStats(runs: TaskRun[]): TaskRunStats {
  let total = 0;
  let success = 0;
  let error = 0;
  let timeout = 0;
  let durSum = 0;
  let durCount = 0;
  let lastSuccessAt: number | null = null;
  let lastFailedAt: number | null = null;

  for (const r of runs) {
    total++;
    if (r.status === "running") continue;
    if (r.status === "success") {
      success++;
      if (lastSuccessAt === null || r.startedAt > lastSuccessAt) lastSuccessAt = r.startedAt;
    } else if (r.status === "error") {
      error++;
      if (lastFailedAt === null || r.startedAt > lastFailedAt) lastFailedAt = r.startedAt;
    } else if (r.status === "timeout") {
      timeout++;
      if (lastFailedAt === null || r.startedAt > lastFailedAt) lastFailedAt = r.startedAt;
    }
    if (r.durationMs !== null) {
      durSum += r.durationMs;
      durCount++;
    }
  }

  const completed = success + error + timeout;
  return {
    total,
    success,
    failed: error + timeout,
    timedOut: timeout,
    successRate: completed === 0 ? 0 : success / completed,
    avgDurationMs: durCount === 0 ? null : Math.round(durSum / durCount),
    lastSuccessAt,
    lastFailedAt,
  };
}

// ── Status helpers ───────────────────────────────────────────────

export type StatusVariant = TaskRunStatus | "paused" | "disabled" | "enabled";

export function statusLabel(s: StatusVariant | null): string {
  switch (s) {
    case "running":  return "运行中";
    case "success":  return "成功";
    case "error":    return "失败";
    case "timeout":  return "超时";
    case "paused":   return "已暂停";
    case "disabled": return "已停用";
    case "enabled":  return "已启用";
    default:         return "—";
  }
}

export function statusVar(s: StatusVariant | null): { fg: string; bg: string } {
  switch (s) {
    case "running":  return { fg: "var(--info)",    bg: "var(--info-bg)" };
    case "success":  return { fg: "var(--success)", bg: "var(--success-bg)" };
    case "error":    return { fg: "var(--error)",   bg: "var(--error-bg)" };
    case "timeout":  return { fg: "var(--warning)", bg: "var(--warning-bg)" };
    case "paused":   return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
    case "disabled": return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
    case "enabled":  return { fg: "var(--success)", bg: "var(--success-bg)" };
    default:         return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
  }
}

// ── Fetch ────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper used by every CRUD call. We don't pass credentials
 * because the scheduler endpoints live on the same origin and Next.js
 * cookies are sent by default.
 *
 * Throws on non-2xx with the server-provided error message attached
 * when available; UI callers display `err.message` in a toast.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = data.error;
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}