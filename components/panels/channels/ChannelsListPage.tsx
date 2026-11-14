"use client";

import { useI18n } from "@/hooks/useI18n";
import { PlusIcon } from "@/components/ui/icons";
import {
  openChannelDetail,
  openChannelForm,
  reloadChannels,
  useChannelsPanel,
} from "@/lib/client/channels-panel";
import type { ChannelRecord } from "@/lib/shared/channels/types";
import { channelStatusColor, channelStatusLabelKey } from "./channelStatus";

export function ChannelsListPage() {
  const { t } = useI18n();
  const { view } = useChannelsPanel();
  const { channels, loaded, loadError, selectedChannelId } = view;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Channels")}</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {channels.length > 0 ? String(channels.length) : ""}
        </span>
        <button
          type="button"
          onClick={openChannelForm}
          aria-label={t("New channel")}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
        >
          <PlusIcon width={12} height={12} />
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
              style={{ marginTop: 6, padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit" }}
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
      aria-pressed={selected}
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
        borderRadius: "var(--radius-sm)",
        transition: "background var(--dur-base) var(--ease-standard)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "var(--radius-xs)",
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
  return <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 6px" }}>{text}</div>;
}
