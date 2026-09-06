"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentLiveInfo } from "@/lib/shared/types";

const POLL_INTERVAL_MS = 5_000;
const ACTIVITY_MAX_HEIGHT = 200;

function fmtElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function fmtClock(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Live activity panel rendered inside the spawn_subagent ToolCallBlock while
 * the child session is still running. Polls
 * /api/subagents/[sessionId]/activity every few seconds for aggregate stats
 * and the child's recent tool-call activity; once the tool finishes the whole
 * panel is replaced by the tool's final result.
 */
export function SpawnSubagentLivePanel({ childSessionId }: { childSessionId: string | null }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<SubagentLiveInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestSeqRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInfo(null);
    if (!childSessionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      const seq = ++requestSeqRef.current;
      try {
        const response = await fetch(`/api/subagents/${encodeURIComponent(childSessionId)}/activity`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as SubagentLiveInfo;
        if (stopped || seq !== requestSeqRef.current) return;
        setInfo(data);
        // task is null when the DB row vanished unexpectedly — keep polling.
        const status = data.task?.status;
        if ((status === "completed" || status === "failed" || status === "cancelled") && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // Transient network/parse errors: the next tick retries.
      }
    };

    void load();
    timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      requestSeqRef.current += 1;
      if (timer) clearInterval(timer);
    };
  }, [childSessionId]);

  const startedAt = info?.task?.startedAt ?? null;
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  // Keep the newest activity in view as entries stream in.
  const activities = info?.activities ?? [];
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [activities.length]);

  const stats = info?.stats;

  return (
    <div style={{ borderTop: "1px solid rgba(34,197,94,0.2)", background: "var(--bg-subtle)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#16a34a" }}>
          <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", flexShrink: 0 }} />
          {t("Subagent running")}
        </span>
        {typeof stats?.assistantCount === "number" && (
          <span>{t("{n} messages", { n: stats.assistantCount })}</span>
        )}
        {typeof stats?.readCount === "number" && (
          <span>{t("{n} files read", { n: stats.readCount })}</span>
        )}
        {stats?.model && (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{t("Model {m}", { m: stats.model })}</span>
        )}
        {startedAt && (
          <span>{t("Elapsed {t}", { t: fmtElapsed(now - startedAt) })}</span>
        )}
      </div>

      {!childSessionId ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {t("Waiting for subagent session…")}
        </div>
      ) : activities.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {t("No activity yet")}
        </div>
      ) : (
        <div
          ref={listRef}
          data-scroll-inset
          style={{ maxHeight: ACTIVITY_MAX_HEIGHT, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {activities.map((activity, index) => (
            <div
              key={`${activity.timestamp ?? "na"}-${activity.toolName}-${index}`}
              style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, minWidth: 0 }}
            >
              <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{activity.timestamp ? fmtClock(activity.timestamp) : "—"}</span>
              <span style={{ color: "#16a34a", flexShrink: 0 }}>{activity.toolName}</span>
              <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {activity.summary}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
