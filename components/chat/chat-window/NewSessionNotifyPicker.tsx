"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../../ui/Tooltip";
import { AnimatedPopover } from "../../ui/AnimatedPopover";
import { chatInputMetrics, TOOLBAR_ICON_STROKE } from "../chat-input/metrics";
import type { ChannelRecord } from "@/lib/shared/channels/types";

interface Props {
  value: string | null;
  onChange: (channelId: string | null) => void;
}

function BellIcon() {
  return (
    <svg width={chatInputMetrics.toolbarIcon} height={chatInputMetrics.toolbarIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={TOOLBAR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
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
      });
    return () => { cancelled = true; };
  }, []);

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
    <div ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <Tooltip content={selected ? `${t("Notification channel")} · ${selected.name}` : t("Notification channel")}>
        <button
          type="button"
          aria-label={t("Notification channel")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: chatInputMetrics.toolbarButton,
            height: chatInputMetrics.toolbarButton,
            padding: 0,
            flexShrink: 0,
            border: "none",
            borderRadius: chatInputMetrics.toolbarRadius,
            background: open ? "var(--bg-hover)" : "none",
            color: selected ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "background var(--dur-base), color var(--dur-base)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = selected ? "var(--accent)" : "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
            e.currentTarget.style.color = selected ? "var(--accent)" : "var(--text-muted)";
          }}
        >
          <BellIcon />
        </button>
      </Tooltip>

      <AnimatedPopover
        open={open}
        role="menu"
        maxHeight={320}
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          right: 0,
          zIndex: 120,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--elevation-prominent)",
          minWidth: 220,
          maxWidth: 320,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", padding: 6 }}>
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            style={{
              display: "flex", width: "100%", alignItems: "center", gap: 8,
              padding: "8px 10px", border: "none", borderRadius: "var(--radius-sm)",
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
                  : channel.status === "expired" ? "var(--error)"
                    : channel.status === "disabled" ? "var(--text-muted)"
                      : "var(--warning)";
              return (
                <button
                  key={channel.id}
                  type="button"
                  disabled={!selectable}
                  onClick={() => { onChange(channel.id); setOpen(false); }}
                  style={{
                    display: "flex", width: "100%", alignItems: "center", gap: 8,
                    padding: "8px 10px", border: "none", borderRadius: "var(--radius-sm)",
                    background: isSelected ? "var(--bg-selected)" : "transparent",
                    color: "var(--text)", cursor: selectable ? "pointer" : "not-allowed",
                    textAlign: "left", fontSize: 12.5, opacity: selectable ? 1 : 0.5,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "var(--radius-xs)", background: statusColor, flexShrink: 0 }} />
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
      </AnimatedPopover>
    </div>
  );
}
