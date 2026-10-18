"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { fetchRecentCwds } from "@/lib/client/channels-io";
import {
  removeChannel,
  renameChannel,
  setChannelWorkspace,
  toggleChannelEnabled,
  useChannelsStore,
} from "@/lib/client/channels-store";
import { ChannelsBackButton } from "./ChannelsBackButton";
import { channelStatusColor, channelStatusLabelKey } from "./ChannelsRootPage";

function shortenPath(p: string, max = 36): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}

/**
 * The channels panel's detail page: one channel, one vertical scroll —
 * status / actions, identity, workspace, and (added by the following tickets)
 * the scan-login card, health block and activity feed. Full width, with a back
 * control and the live actions (rename, enable / disable, delete) up top.
 *
 * Every field here is a write-through item (ADR-0009): rename, enable / disable
 * and the workspace switch all land immediately, so this page has no save bar
 * and no unsaved-changes marker. The selected channel and the page stack live
 * in the module store, so a tab switch keeps the page.
 */
export function ChannelDetailPage({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { channels, busy } = useChannelsStore();
  const channel = channels.find((item) => item.id === channelId) ?? null;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(channel?.name ?? "");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchRecentCwds().then(setRecentCwds);
  }, []);

  // When the channel is renamed (here or elsewhere) re-seed the rename input.
  useEffect(() => {
    setNameDraft(channel?.name ?? "");
  }, [channel?.name]);

  // Close the workspace menu on outside click.
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [workspaceMenuOpen]);

  const saveRename = useCallback(async () => {
    if (!channel) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === channel.name) {
      setRenaming(false);
      return;
    }
    const result = await renameChannel(channel.id, trimmed);
    if (!result.ok) {
      toast.show({ kind: "error", message: t("channels.renameFailed") });
      return;
    }
    setRenaming(false);
    toast.show({ kind: "success", message: t("channels.renamed") });
  }, [channel, nameDraft, toast, t]);

  const toggleEnabled = useCallback(async () => {
    if (!channel) return;
    const result = await toggleChannelEnabled(channel.id, channel.status === "disabled");
    if (!result.ok) toast.show({ kind: "error", message: t("channels.operationFailed") });
  }, [channel, toast, t]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!channel) return;
      setWorkspaceMenuOpen(false);
      const result = await setChannelWorkspace(channel.id, workspaceId);
      if (!result.ok) {
        toast.show({ kind: "error", message: t(result.error ?? "channels.operationFailed") });
        return;
      }
      toast.show({ kind: "info", message: t("Workspace switched") });
    },
    [channel, toast, t],
  );

  const deleteChannel = useCallback(async () => {
    if (!channel) return;
    const ok = await confirm({
      title: t("channels.delete"),
      description: t("channels.deleteChannelConfirm", { name: channel.name }),
      confirmLabel: t("channels.confirm"),
      destructive: true,
    });
    if (!ok) return;
    const result = await removeChannel(channel.id);
    if (!result.ok) {
      toast.show({ kind: "error", message: t("channels.operationFailed") });
      return;
    }
    toast.show({ kind: "info", message: t("Channel deleted") });
  }, [channel, confirm, toast, t]);

  if (!channel) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: "10px 14px", flexShrink: 0 }}>
          <ChannelsBackButton />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
          {t("channels.unavailable")}
        </div>
      </div>
    );
  }

  const workspace = channel.workspaceId;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header: back + name / rename + status */}
      <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <ChannelsBackButton />
        {renaming ? (
          <>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
                else if (e.key === "Escape") setRenaming(false);
              }}
              autoFocus
              maxLength={50}
              placeholder={t("channels.channelName")}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "4px 8px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={() => void saveRename()}
              disabled={busy || !nameDraft.trim()}
              style={{ padding: "4px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, flexShrink: 0, cursor: busy || !nameDraft.trim() ? "not-allowed" : "pointer", opacity: busy || !nameDraft.trim() ? 0.6 : 1, fontFamily: "inherit" }}
            >
              {t("channels.save")}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={busy}
              style={{ padding: "4px 12px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, flexShrink: 0, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {t("channels.cancel")}
            </button>
          </>
        ) : (
          <>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: channelStatusColor(channel.status), flexShrink: 0 }} />
            <strong style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {channel.name}
            </strong>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {t(channelStatusLabelKey(channel.status))}
            </span>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              style={{ padding: "3px 10px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, flexShrink: 0, cursor: "pointer", fontFamily: "inherit" }}
            >
              {t("channels.rename")}
            </button>
          </>
        )}
      </div>

      {/* One vertical scroll for the whole page body. */}
      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "0 14px 18px" }}>
        {/* Identity */}
        <section style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 12px", padding: 12, borderRadius: 8, background: "var(--bg)", fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.channelId")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.id}</code>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.boundUser")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.userId ?? t("channels.notScanned")}</code>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.accountId")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.accountId ?? "—"}</code>
        </section>

        {/* Workspace */}
        <section ref={workspaceMenuRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "var(--bg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("channels.currentWorkspace")}:</span>
            {workspace ? (
              <button
                type="button"
                onClick={() => setWorkspaceMenuOpen((v) => !v)}
                title={workspace}
                style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {shortenPath(workspace)}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("channels.notSet")}</span>
            )}
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((v) => !v)}
              style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 5, padding: "2px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
            >
              {t("channels.switchWorkspace")}
            </button>
          </div>
          {workspaceMenuOpen && (
            <div
              data-scroll-inset
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 10,
                marginTop: 4,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {recentCwds.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>{t("channels.noWorkspaces")}</div>
              ) : (
                <>
                  <div style={{ padding: "6px 10px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase" }}>
                    {t("channels.recent")}
                  </div>
                  {recentCwds.map((cwd) => (
                    <button
                      key={`r-${cwd}`}
                      type="button"
                      onClick={() => void switchWorkspace(cwd)}
                      title={cwd}
                      style={{ display: "block", width: "100%", padding: "6px 10px", background: cwd === workspace ? "var(--bg-selected)" : "none", border: "none", textAlign: "left", cursor: "pointer", color: cwd === workspace ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {shortenPath(cwd, 40)}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </section>

        {/* Actions */}
        <section style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {channel.status === "connected" ? (
            <button
              type="button"
              onClick={() => void toggleEnabled()}
              disabled={busy}
              style={{ padding: "5px 12px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {t("channels.disable")}
            </button>
          ) : channel.status === "disabled" ? (
            <button
              type="button"
              onClick={() => void toggleEnabled()}
              disabled={busy}
              style={{ padding: "5px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "inherit" }}
            >
              {t("channels.enable")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void deleteChannel()}
            disabled={busy}
            style={{ marginLeft: "auto", padding: "5px 12px", background: "transparent", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
          >
            {t("channels.delete")}
          </button>
        </section>
      </div>
    </div>
  );
}
