"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ChannelActivity } from "@/lib/shared/channels/types";

const ACTIVITY_LIMIT = 50;

/** Dot color per event kind so the feed reads at a glance. */
const KIND_COLOR: Record<ChannelActivity["kind"], string> = {
  message_received: "var(--text-muted)",
  session_started: "var(--accent)",
  agent_sent: "var(--accent)",
  agent_done: "#22c55e",
  agent_error: "#ef4444",
  reply: "#22c55e",
  reply_failed: "#ef4444",
  session_reset: "var(--text-muted)",
  workspace_missing: "#f59e0b",
  workspace_unusable: "#f59e0b",
  token_expired: "#ef4444",
  worker_started: "var(--text-muted)",
  worker_stopped: "#f59e0b",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms?: number): string {
  if (ms === undefined) return "";
  const s = ms / 1000;
  return `${s < 60 ? s.toFixed(1) : (s / 60).toFixed(1)}${s < 60 ? "s" : "min"}`;
}

function preview(text: string | undefined, max = 60): string {
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

export function ChannelActivityFeed({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<ChannelActivity[]>([]);
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/activity?limit=${ACTIVITY_LIMIT}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { activity?: ChannelActivity[] };
      if (data.activity) setEvents(data.activity);
    } catch {
      // transient — the interval retries
    }
  }, [channelId]);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => void refresh(), 3500);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [refresh]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "var(--bg)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
          padding: 0, cursor: "pointer", textAlign: "left", color: "var(--text)", fontSize: 13, fontWeight: 600,
        }}
      >
        <span>{t("channels.act.title")}</span>
      </button>

      {open && (
        <div data-scroll-inset style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto", gap: 2 }}>
          {events.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" }}>{t("channels.act.empty")}</div>
          ) : (
            events.map((e, i) => {
              const label = t(`channels.act.${e.kind}`);
              const body = [
                e.text ? preview(e.text) : undefined,
                e.kind === "agent_done" && e.durationMs !== undefined ? fmtDuration(e.durationMs) : undefined,
                e.detail ? preview(e.detail, 80) : undefined,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={`${e.ts}-${i}`}
                  style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--text)", padding: "3px 2px", alignItems: "baseline" }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{fmtTime(e.ts)}</span>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: KIND_COLOR[e.kind] ?? "var(--text-muted)", flexShrink: 0, alignSelf: "center" }} />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--text)" }}>{label}</span>
                    {e.fromUserId ? <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{preview(e.fromUserId, 24)}</span> : null}
                    {body ? <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>· {body}</span> : null}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}