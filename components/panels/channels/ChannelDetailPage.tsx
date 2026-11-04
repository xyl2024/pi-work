"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { SmartImage } from "@/components/ui/SmartImage";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { fetchChannelStatus, fetchRecentCwds, type ChannelStatusDetail } from "@/lib/client/channels-io";
import {
  refreshLoginQr,
  removeChannel,
  renameChannel,
  setChannelWorkspace,
  setLoginCode,
  startLogin,
  submitLoginCode,
  toggleChannelEnabled,
  useChannelsPanel,
} from "@/lib/client/channels-panel";
import { loginPhaseLabelKey } from "@/lib/shared/channels-login";
import { ChannelActivityFeed } from "@/components/channels/ChannelActivityFeed";
import { channelStatusColor, channelStatusLabelKey } from "./channelStatus";

function shortenPath(p: string, max = 36): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}

function fmtAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function retryIn(retryInMs: number | null): string {
  if (retryInMs == null) return "0s";
  return retryInMs >= 1000 ? `${Math.round(retryInMs / 1000)}s` : `${Math.round(retryInMs)}ms`;
}

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderRadius: 8,
  background: "var(--bg)",
} as const;

const primaryButtonStyle = {
  padding: "5px 12px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "inherit",
} as const;

const ghostButtonStyle = {
  padding: "5px 12px",
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "inherit",
} as const;

export function ChannelDetailPage({
  channelId,
  onBack,
}: {
  channelId: string;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { view } = useChannelsPanel();
  const { channels, busy, login: loginState } = view;
  const channel = channels.find((item) => item.id === channelId) ?? null;
  const login = loginState.channelId === channelId ? loginState : null;

  const [nameDraft, setNameDraft] = useState(channel?.name ?? "");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [status, setStatus] = useState<ChannelStatusDetail | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchChannelStatus(channelId));
    } catch {
    }
  }, [channelId]);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    void fetchRecentCwds().then(setRecentCwds);
  }, []);

  useEffect(() => {
    setNameDraft(channel?.name ?? "");
  }, [channel?.name]);

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

  const loginPhase = loginState.channelId === channelId ? loginState.phase : null;
  useEffect(() => {
    if (loginPhase === "confirmed") {
      toast.show({ kind: "success", message: t("channels.connected") });
      void refreshStatus();
    } else if (loginPhase === "already_bound") {
      toast.show({ kind: "error", message: t("channels.alreadyBound") });
    }
  }, [loginPhase, refreshStatus, toast, t]);

  const submitRename = useCallback(async () => {
    if (!channel) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === channel.name) return;
    const result = await renameChannel(channel.id, trimmed);
    if (!result.ok) {
      toast.show({ kind: "error", message: t("channels.renameFailed") });
      return;
    }
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
        toast.show({ kind: "error", message: result.error ?? t("channels.operationFailed") });
        return;
      }
      toast.show({ kind: "info", message: t("Workspace switched") });
    },
    [channel, toast, t],
  );

  const startScan = useCallback(async () => {
    if (!channel) return;
    const result = await startLogin(channel.id);
    if (!result.ok && result.error) toast.show({ kind: "error", message: t("channels.loginFailed") });
  }, [channel, toast, t]);

  const submitCode = useCallback(async () => {
    const result = await submitLoginCode();
    if (!result.ok && result.error) toast.show({ kind: "error", message: t("channels.operationFailed") });
  }, [toast, t]);

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
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
        {t("channels.unavailable")}
      </div>
    );
  }

  const userId = status?.userId ?? channel.userId;
  const workspace = status?.currentWorkspaceId ?? channel.workspaceId;
  const workspaceBroken = status?.workspaceAvailable === false;
  const health = status?.health;
  const healthLines = [
    status?.monitorRunning ? t("channels.statusLive") : t("channels.statusIdle"),
    health?.lastPollAt
      ? `${t("channels.healthLastPoll")} ${t("channels.healthAgo", { s: fmtAgo(health.lastPollAt) })}`
      : `${t("channels.healthLastPoll")} —`,
    t("channels.healthFailures", { n: health?.consecutiveFailures ?? 0 }),
    t("channels.healthNextRetry", {
      s: health?.backingOff && health.retryInMs != null ? retryIn(health.retryInMs) : "—",
    }),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 8px", flexShrink: 0 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("Back")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
          </button>
        )}
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: channelStatusColor(channel.status), flexShrink: 0 }} />
        <strong style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {channel.name}
        </strong>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {t(channelStatusLabelKey(channel.status))}
        </span>
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "0 16px 18px" }}>
        <section style={sectionStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>{t("channels.boundUser")}</span>
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userId ?? t("channels.notScanned")}</code>
            <span style={{ color: "var(--text-muted)" }}>{t("channels.currentWorkspace")}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: workspaceBroken ? "#ef4444" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={workspace ?? undefined}>
              {workspace ? shortenPath(workspace) : t("channels.notSet")}
              {workspaceBroken ? ` (${t("channels.workspaceUnavailable")})` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {channel.status === "connected" ? (
              <button type="button" onClick={() => void toggleEnabled()} disabled={busy} style={{ ...ghostButtonStyle, cursor: busy ? "not-allowed" : "pointer" }}>
                {t("channels.disable")}
              </button>
            ) : channel.status === "disabled" ? (
              <button type="button" onClick={() => void toggleEnabled()} disabled={busy} style={{ ...primaryButtonStyle, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {t("channels.enable")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void deleteChannel()}
              disabled={busy}
              style={{ ...ghostButtonStyle, marginLeft: "auto", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", cursor: busy ? "not-allowed" : "pointer" }}
            >
              {t("channels.delete")}
            </button>
          </div>
        </section>

        <section style={sectionStyle}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }} htmlFor="channel-rename">
            {t("channels.rename")}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="channel-rename"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitRename(); }}
              maxLength={50}
              placeholder={t("channels.channelName")}
              style={{ flex: 1, minWidth: 0, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
            />
            <button
              type="button"
              onClick={() => void submitRename()}
              disabled={busy || !nameDraft.trim() || nameDraft.trim() === channel.name}
              style={{ ...primaryButtonStyle, flexShrink: 0, cursor: busy || !nameDraft.trim() || nameDraft.trim() === channel.name ? "not-allowed" : "pointer", opacity: busy || !nameDraft.trim() || nameDraft.trim() === channel.name ? 0.6 : 1 }}
            >
              {t("channels.save")}
            </button>
          </div>
        </section>

        <section ref={workspaceMenuRef} style={{ ...sectionStyle, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("channels.switchWorkspace")}</span>
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((v) => !v)}
              style={{ marginLeft: "auto", background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 5, padding: "3px 10px", fontSize: 11, cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
            >
              {t("channels.recent")}
            </button>
          </div>
          {workspaceMenuOpen && (
            <div
              data-scroll-inset
              style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", maxHeight: 240, overflowY: "auto" }}
            >
              {recentCwds.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>{t("channels.noWorkspaces")}</div>
              ) : (
                recentCwds.map((cwd) => (
                  <button
                    key={cwd}
                    type="button"
                    onClick={() => void switchWorkspace(cwd)}
                    title={cwd}
                    style={{ display: "block", width: "100%", padding: "6px 10px", background: cwd === workspace ? "var(--bg-selected)" : "none", border: "none", textAlign: "left", cursor: "pointer", color: cwd === workspace ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {shortenPath(cwd, 40)}
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        <section style={{ ...sectionStyle, alignItems: "center" }}>
          {(channel.status === "pending" || channel.status === "expired") && (
            <button type="button" onClick={() => void startScan()} disabled={busy} style={{ ...primaryButtonStyle, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {t("channels.scanToConnect")}
            </button>
          )}
          {channel.status === "connected" && (
            <button type="button" onClick={() => void startScan()} disabled={busy} style={{ ...ghostButtonStyle, cursor: busy ? "not-allowed" : "pointer" }}>
              {t("channels.rescan")}
            </button>
          )}
          {login && login.sessionKey && (
            <>
              {login.qrDataUrl && (
                <div style={{ padding: 10, background: "#fff", borderRadius: 8, border: "1px solid var(--border)", maxWidth: "100%", boxSizing: "border-box" }}>
                  <SmartImage src={login.qrDataUrl} alt="" loaderSize={96} width={224} height={224} style={{ display: "block", width: 224, maxWidth: "100%", height: "auto" }} />
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5, textAlign: "center" }}>
                {t("channels.scanHint")}
              </p>
              {login.qrUrl && (
                <a href={login.qrUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}>
                  {login.qrUrl}
                </a>
              )}
              {login.phase && (
                <div style={{ fontSize: 12, color: "var(--text)", padding: "4px 10px", background: "var(--bg-hover)", borderRadius: 4, textAlign: "center", maxWidth: "100%" }}>
                  {t(loginPhaseLabelKey(login.phase))}
                  {login.phaseMessage ? ` — ${t(login.phaseMessage)}` : ""}
                </div>
              )}
              {login.phase === "verifying" && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                  <input
                    type="text"
                    value={login.code}
                    onChange={(e) => setLoginCode(e.target.value)}
                    placeholder={t("channels.pairingCode")}
                    autoFocus
                    inputMode="numeric"
                    style={{ width: 140, height: 28, padding: "4px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontSize: 13, fontFamily: "var(--font-mono)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void submitCode()}
                    disabled={login.busy || !login.code.trim()}
                    style={{ padding: "4px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, cursor: login.busy || !login.code.trim() ? "not-allowed" : "pointer", opacity: login.busy || !login.code.trim() ? 0.5 : 1, fontFamily: "inherit" }}
                  >
                    {t("channels.submit")}
                  </button>
                </div>
              )}
              {(login.phase === "expired" || login.phase === "error" || login.phase === "verify_blocked") && (
                <button type="button" onClick={() => refreshLoginQr(channel.id)} disabled={login.busy} style={{ ...ghostButtonStyle, cursor: login.busy ? "not-allowed" : "pointer" }}>
                  {t("channels.refreshQr")}
                </button>
              )}
            </>
          )}
        </section>

        <section style={sectionStyle}>
          {healthLines.map((line, index) => (
            <div key={index} style={{ fontSize: 12, color: index === 0 ? "var(--text)" : "var(--text-muted)" }}>
              {line}
            </div>
          ))}
        </section>

        <ChannelActivityFeed channelId={channel.id} />
      </div>
    </div>
  );
}
