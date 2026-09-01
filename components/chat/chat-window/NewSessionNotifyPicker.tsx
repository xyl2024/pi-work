"use client";

/**
 * NewSessionNotifyPicker — pick the messaging channel (from the Channels
 * page, WeChat for now) that should receive this session's assistant
 * replies. Shown on the new-session welcome screen. Only connected channels
 * with a bound user are selectable; choosing none means "don't notify".
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ChannelRecord } from "@/lib/shared/channels/types";

interface Props {
  value: string | null;
  onChange: (channelId: string | null) => void;
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function NewSessionNotifyPicker({ value, onChange }: Props) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/channels?provider=wechat", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { channels?: ChannelRecord[] }) => {
        if (!cancelled) setChannels(d.channels ?? []);
      })
      .catch(() => {
        // transient — keep the picker usable with an empty list
      });
    return () => { cancelled = true; };
  }, []);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = channels.find((c) => c.id === value) ?? null;

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("Notify this session's replies to a channel")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 12px",
          background: "var(--bg-subtle)",
          border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 20,
          color: "var(--text)",
          cursor: "pointer",
          fontSize: 12.5,
        }}
      >
        <span style={{ color: selected ? "var(--accent)" : "var(--text-muted)", display: "flex" }}>
          <BellIcon />
        </span>
        <span>{selected ? selected.name : t("Notification channel")}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10, opacity: 0.8 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 40,
            minWidth: 220,
            maxWidth: 320,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
            padding: 6,
          }}
        >
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            style={{
              display: "flex", width: "100%", alignItems: "center", gap: 8,
              padding: "8px 10px", border: "none", borderRadius: 6,
              background: value === null ? "var(--bg-selected)" : "transparent",
              color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12.5,
            }}
          >
            <span style={{ flex: 1 }}>{t("No notification")}</span>
            {value === null && <span style={{ color: "var(--accent)" }}>✓</span>}
          </button>

          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

          {channels.length === 0 ? (
            <p style={{ margin: 0, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
              {t("channels.noChannels")}
            </p>
          ) : (
            channels.map((channel) => {
              const selectable = channel.status === "connected" && !!channel.userId;
              const isSelected = value === channel.id;
              const statusColor =
                channel.status === "connected" ? "var(--accent)"
                  : channel.status === "expired" ? "#ef4444"
                    : channel.status === "disabled" ? "var(--text-muted)"
                      : "#f59e0b";
              return (
                <button
                  key={channel.id}
                  type="button"
                  disabled={!selectable}
                  onClick={() => { onChange(channel.id); setOpen(false); }}
                  style={{
                    display: "flex", width: "100%", alignItems: "center", gap: 8,
                    padding: "8px 10px", border: "none", borderRadius: 6,
                    background: isSelected ? "var(--bg-selected)" : "transparent",
                    color: "var(--text)", cursor: selectable ? "pointer" : "not-allowed",
                    textAlign: "left", fontSize: 12.5, opacity: selectable ? 1 : 0.5,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {channel.name}
                  </span>
                  {!selectable && (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
                      {channel.status === "connected" ? t("channels.notScanned") : t(`channels.${channel.status}`)}
                    </span>
                  )}
                  {isSelected && <span style={{ color: "var(--accent)" }}>✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
