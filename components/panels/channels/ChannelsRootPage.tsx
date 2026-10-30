"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import {
  createChannelInStore,
  openChannelDetail,
  reloadChannels,
  setChannelsNameDraft,
  useChannelsStore,
} from "@/lib/client/channels-store";
import type { ChannelRecord } from "@/lib/shared/channels/types";
import { channelStatusColor, channelStatusLabelKey } from "./channelStatus";

export function ChannelsRootPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { channels, loaded, loadError, nameDraft, busy, selectedChannelId } =
    useChannelsStore();

  async function create() {
    const result = await createChannelInStore();
    if (!result.ok && result.error && result.error !== "name_required") {
      toast.show({ kind: "error", message: t("channels.operationFailed") });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Channels")}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {channels.length > 0 ? String(channels.length) : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "0 14px 10px", flexShrink: 0 }}>
        <input
          value={nameDraft}
          onChange={(e) => setChannelsNameDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder={t("channels.channelName")}
          maxLength={50}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />
        <button
          type="button"
          disabled={busy || !nameDraft.trim()}
          onClick={() => void create()}
          style={{
            padding: "6px 12px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: busy || !nameDraft.trim() ? "not-allowed" : "pointer",
            opacity: busy || !nameDraft.trim() ? 0.6 : 1,
            flexShrink: 0,
            fontFamily: "inherit",
          }}
        >
          {busy ? t("channels.creating") : t("channels.newChannel")}
        </button>
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 16px" }}>
        {!loaded && !loadError && <Hint text={t("Loading...")} />}
        {loadError && (
          <div style={{ padding: "10px 6px" }}>
            <div style={{ fontSize: 12, color: "var(--error)" }}>{t("Failed to load")}</div>
            <button
              type="button"
              onClick={reloadChannels}
              style={{
                marginTop: 6,
                padding: "4px 10px",
                fontSize: 12,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("Retry")}
            </button>
          </div>
        )}
        {loaded && !loadError && channels.length === 0 && <Hint text={t("channels.noChannels")} />}
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            selected={channel.id === selectedChannelId}
            onSelect={() => openChannelDetail(channel.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  selected,
  onSelect,
}: {
  channel: ChannelRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-channel-row={channel.id}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "2px 6px",
        padding: "9px 11px",
        cursor: "pointer",
        background: selected ? "var(--bg-selected)" : "transparent",
        borderRadius: 8,
        transition: "background 0.12s",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: channelStatusColor(channel.status),
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{channel.name}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
          {channel.userId ?? t("channels.notScanned")}
        </span>
      </span>
      <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
        {t(channelStatusLabelKey(channel.status))}
      </span>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 6px" }}>{text}</div>
  );
}
