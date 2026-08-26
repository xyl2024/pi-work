"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { ChannelPlatformList } from "./ChannelPlatformList";
import { WechatChannelDetail } from "./WechatChannelDetail";
import type { ChannelRecord } from "@/lib/shared/channels/types";

export function ChannelsSection() {
  const { t } = useI18n();
  const toast = useToast();
  const [platform, setPlatform] = useState("wechat");
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = channels.find((channel) => channel.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?provider=wechat", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { channels?: ChannelRecord[] };
      setChannels(data.channels ?? []);
    } catch {
      // ignore — settings modal stays usable
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.show({ kind: "error", message: t("channels.nameRequired") });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, provider: "wechat" }),
      });
      if (!res.ok) {
        toast.show({ kind: "error", message: t("channels.operationFailed") });
        return;
      }
      setName("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 18 }}>
      <ChannelPlatformList active={platform} onSelect={setPlatform} />

      <div>
        {platform !== "wechat" ? (
          <div style={{ color: "var(--text-muted)", padding: 20 }}>{t("channels.notSupported")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Create channel */}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
                placeholder={t("channels.channelName")}
                style={{
                  flex: 1, padding: "8px 10px", border: "1px solid var(--border)",
                  borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 13,
                }}
              />
              <button
                disabled={busy || !name.trim()}
                onClick={() => void create()}
                style={{
                  padding: "8px 14px", background: "var(--accent)", color: "var(--bg)",
                  border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: busy || !name.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !name.trim() ? 0.6 : 1,
                }}
              >
                {busy ? t("channels.creating") : t("channels.newChannel")}
              </button>
            </div>

            {/* Channel list */}
            {channels.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 10px", background: "var(--bg)", borderRadius: 6, margin: 0 }}>
                {t("channels.noChannels")}
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {channels.map((channel) => {
                  const isSelected = selected?.id === channel.id;
                  const statusColor =
                    channel.status === "connected" ? "var(--accent)"
                      : channel.status === "expired" ? "#ef4444"
                        : channel.status === "disabled" ? "var(--text-muted)"
                          : "#f59e0b";
                  return (
                    <button
                      key={channel.id}
                      onClick={() => setSelectedId(channel.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        textAlign: "left", padding: "10px 12px",
                        border: "1px solid var(--border)", borderRadius: 8,
                        background: isSelected ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)", cursor: "pointer",
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <strong style={{ fontSize: 13 }}>{channel.name}</strong>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                          {channel.userId ?? t("channels.notScanned")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Detail */}
            {selected && (
              <WechatChannelDetail
                channel={selected}
                onChanged={refresh}
                onDeleted={() => { setSelectedId(null); void refresh(); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}