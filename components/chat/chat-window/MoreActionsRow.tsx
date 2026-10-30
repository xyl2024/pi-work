"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../../ui/Tooltip";
import { AnimatedPopover } from "../../ui/AnimatedPopover";
import { useChatHeaderActions } from "@/hooks/chatHeaderActionsStore";
import { useConfirm } from "../../ui/ConfirmDialog";
import {
  CompressIcon,
  DownloadIcon,
  EditIcon,
  NotificationIcon,
  RefreshIcon,
} from "@/components/ui/icons";
import type { ChannelRecord } from "@/lib/shared/channels/types";

const launcherButtonClass =
  "pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100";

function launcherStyle(enabled: boolean): React.CSSProperties {
  return {
    background: "var(--bg-panel)",
    borderColor: "var(--border)",
    color: enabled ? "var(--text-muted)" : "var(--text-dim)",
    opacity: enabled ? 1 : 0.45,
  };
}

export function MoreActionsRow() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const headerActions = useChatHeaderActions();
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const notifyContainerRef = useRef<HTMLDivElement>(null);

  const notifyVisible = headerActions?.notifyVisible ?? false;

  useEffect(() => {
    if (!notifyOpen) return;
    let cancelled = false;
    fetch("/api/channels?provider=wechat", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { channels?: ChannelRecord[] }) => {
        if (!cancelled) setChannels(d.channels ?? []);
      })
      .catch(() => {
      });
    return () => { cancelled = true; };
  }, [notifyOpen]);

  useEffect(() => {
    if (!notifyOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (notifyContainerRef.current && !notifyContainerRef.current.contains(e.target as Node)) {
        setNotifyOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNotifyOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifyOpen]);

  if (!headerActions) return null;

  const visibleCount =
    (headerActions.replayVisible ? 1 : 0) +
    (headerActions.exportVisible ? 1 : 0) +
    (headerActions.autoNameVisible ? 1 : 0) +
    (headerActions.compactVisible ? 1 : 0) +
    (notifyVisible ? 1 : 0);
  if (visibleCount === 0) return null;

  const currentBinding =
    headerActions.currentNotifyChannelId != null
      ? channels.find((c) => c.id === headerActions.currentNotifyChannelId)?.name ?? null
      : null;

  return (
    <div className="flex items-end gap-2" style={{ marginRight: 8 }}>
      {headerActions.replayVisible && (
        <Tooltip content={t("Replay")}>
          <button
            type="button"
            onClick={headerActions.onOpenReplay}
            aria-label={t("Replay")}
            className={launcherButtonClass}
            style={launcherStyle(true)}
          >
            <RefreshIcon size={16} />
          </button>
        </Tooltip>
      )}
      {headerActions.exportVisible && (
        <Tooltip content={headerActions.isExporting ? t("Exporting...") : t("Export session")}>
          <button
            type="button"
            onClick={headerActions.onExport}
            disabled={headerActions.isExporting}
            aria-label={t("Export session")}
            className={launcherButtonClass}
            style={launcherStyle(!headerActions.isExporting)}
          >
            <DownloadIcon size={16} />
          </button>
        </Tooltip>
      )}
      {headerActions.autoNameVisible && (
        <Tooltip content={headerActions.isAutoNaming ? t("Naming...") : t("Auto-name session")}>
          <button
            type="button"
            onClick={headerActions.onAutoName}
            disabled={headerActions.isAutoNaming || !headerActions.canAutoName}
            aria-label={t("Auto-name session")}
            className={launcherButtonClass}
            style={launcherStyle(!headerActions.isAutoNaming && headerActions.canAutoName)}
          >
            <EditIcon size={16} />
          </button>
        </Tooltip>
      )}
      {headerActions.compactVisible && (
        <Tooltip content={headerActions.isCompacting ? t("Compacting...") : t("Compact")}>
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: t("Compact context?"),
                description: t(
                  "This will summarize the conversation so far and clear older messages from the visible context. The compaction summary will be kept."
                ),
                confirmLabel: t("Compact"),
                cancelLabel: t("Cancel"),
                destructive: false,
              });
              if (ok) headerActions.onCompact();
            }}
            disabled={headerActions.isCompacting || headerActions.compactDisabled}
            aria-label={t("Compact")}
            className={launcherButtonClass}
            style={launcherStyle(!(headerActions.isCompacting || headerActions.compactDisabled))}
          >
            <CompressIcon size={16} />
          </button>
        </Tooltip>
      )}
      {notifyVisible && (
        <div
          ref={notifyContainerRef}
          className="relative flex items-end"
        >
          <Tooltip content={currentBinding ? `${t("Notification channel")} · ${currentBinding}` : t("Notification channel")}>
            <button
              type="button"
              onClick={() => setNotifyOpen((o) => !o)}
              aria-label={t("Notification channel")}
              aria-haspopup="menu"
              aria-expanded={notifyOpen}
              className={launcherButtonClass}
              style={{
                ...launcherStyle(true),
                color: currentBinding ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <NotificationIcon size={16} />
            </button>
          </Tooltip>
          <AnimatedPopover
            open={notifyOpen}
            role="menu"
            maxHeight={320}
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              right: 0,
              zIndex: 120,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
              minWidth: 220,
              maxWidth: 320,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", padding: 6 }}>
              <button
                type="button"
                onClick={() => {
                  headerActions.onSetNotifyChannel(null);
                  setNotifyOpen(false);
                }}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 8,
                  padding: "8px 10px", border: "none", borderRadius: 6,
                  background: headerActions.currentNotifyChannelId == null ? "var(--bg-selected)" : "transparent",
                  color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1 }}>{t("No notification")}</span>
                {headerActions.currentNotifyChannelId == null && (
                  <span style={{ color: "var(--accent)" }}>✓</span>
                )}
              </button>

              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

              {channels.length === 0 ? (
                <p style={{ margin: 0, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                  {t("channels.noChannels")}
                </p>
              ) : (
                channels.map((channel) => {
                  const selectable = channel.status === "connected" && !!channel.userId;
                  const isSelected = headerActions.currentNotifyChannelId === channel.id;
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
                      onClick={() => {
                        headerActions.onSetNotifyChannel(channel.id);
                        setNotifyOpen(false);
                      }}
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
          </AnimatedPopover>
        </div>
      )}
    </div>
  );
}
