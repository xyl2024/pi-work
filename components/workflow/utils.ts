/**
 * Pure helpers for the workflow UI: thin fetch wrapper, relative/duration
 * formatters, graph layout + id helpers, and status color maps. No React
 * imports.
 */

import type { Locale } from "@/lib/shared/i18n-dict";
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from "@/lib/shared/workflow";

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Pi-Work-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = data.error;
    } catch {
      // non-JSON body
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function formatRelative(now: number, ts: number | null, locale: Locale = "zh"): string {
  if (ts === null || !Number.isFinite(ts)) return "—";
  const diffMs = ts - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;

  if (abs < 30_000) return past ? (locale === "zh" ? "刚刚" : "just now") : (locale === "zh" ? "即将" : "in a moment");
  const min = Math.round(abs / 60_000);
  if (min < 60) return past ? (locale === "zh" ? `${min} 分钟前` : `${min} minutes ago`) : (locale === "zh" ? `${min} 分钟后` : `in ${min} minutes`);
  const hr = Math.round(min / 60);
  if (hr < 24) return past ? (locale === "zh" ? `${hr} 小时前` : `${hr} hours ago`) : (locale === "zh" ? `${hr} 小时后` : `in ${hr} hours`);
  const day = Math.round(hr / 24);
  if (day < 7) return past ? (locale === "zh" ? `${day} 天前` : `${day} days ago`) : (locale === "zh" ? `${day} 天后` : `in ${day} days`);
  return new Date(ts).toLocaleString();
}

export function newNodeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface LayoutNodeLike {
  id: string;
  dependsOn: string[];
}

/** Left-to-right layered layout for a dependsOn DAG. Returns id → (x, y).
 *  Mirrors the server's auto-layout so the canvas and the store agree. */
export function layeredLayout<T extends LayoutNodeLike>(nodes: T[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  const GX = 264;
  const GY = 96;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layer = new Map<string, number>();
  const compute = (id: string): number => {
    const c = layer.get(id);
    if (c !== undefined) return c;
    const node = byId.get(id);
    if (!node || node.dependsOn.length === 0) {
      layer.set(id, 0);
      return 0;
    }
    const l = 1 + Math.max(0, ...node.dependsOn.map((d) => compute(d)));
    layer.set(id, l);
    return l;
  };
  for (const n of nodes) compute(n.id);
  const byLayer = new Map<number, T[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(n);
    byLayer.set(l, arr);
  }
  let maxY = 0;
  for (const [, arr] of byLayer) maxY = Math.max(maxY, (arr.length - 1) * GY);
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    out.set(n.id, { x: 30 + l * GX, y: 40 + arr.indexOf(n) * GY + (maxY - (arr.length - 1) * GY) / 2 });
  }
  return out;
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remS = Math.round(s - m * 60);
  return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
}

export type RunVariant = WorkflowRunStatus;
export type NodeVariant = WorkflowNodeRunStatus;

export function runColor(s: WorkflowRunStatus): { fg: string; bg: string } {
  switch (s) {
    case "running":  return { fg: "var(--info)",    bg: "var(--info-bg)" };
    case "success":  return { fg: "var(--success)", bg: "var(--success-bg)" };
    case "failed":   return { fg: "var(--error)",   bg: "var(--error-bg)" };
    default:         return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
  }
}

export function nodeColor(s: WorkflowNodeRunStatus): { fg: string; bg: string } {
  switch (s) {
    case "running":  return { fg: "var(--info)",    bg: "var(--info-bg)" };
    case "success":  return { fg: "var(--success)", bg: "var(--success-bg)" };
    case "failed":
    case "interrupted": return { fg: "var(--error)", bg: "var(--error-bg)" };
    case "skipped":  return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
    default:         return { fg: "var(--text-muted)", bg: "var(--bg-subtle)" };
  }
}