"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { SmartImage } from "../ui/SmartImage";
import type { ChannelRecord } from "@/lib/shared/channels/types";

type LoginPhase =
  | "waiting"
  | "scanned"
  | "verifying"
  | "verify_blocked"
  | "redirected"
  | "confirmed"
  | "already_bound"
  | "expired"
  | "error";

const PHASE_LABEL_KEYS: Record<LoginPhase, string> = {
  waiting: "channels.waitingScan",
  scanned: "channels.scanned",
  verifying: "channels.verifying",
  verify_blocked: "channels.verifyBlocked",
  redirected: "channels.redirected",
  confirmed: "channels.confirmed",
  already_bound: "channels.alreadyBound",
  expired: "channels.qrExpired",
  error: "channels.error",
};

const STATUS_LABEL_KEYS: Record<ChannelRecord["status"], string> = {
  pending: "channels.pending",
  connected: "channels.connected",
  disabled: "channels.disabled",
  expired: "channels.expired",
};

interface LoginInfo {
  sessionKey: string;
  qrDataUrl: string;
  qrUrl: string;
  expiresAt: number;
}

interface StatusDetail {
  configured: boolean;
  accountId: string | null;
  userId: string | null;
  status: string;
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  workspaceAvailable: boolean | null;
  monitorRunning: boolean;
}

function shortenPath(p: string, max = 36): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}

export function WechatChannelDetail({
  channel,
  onChanged,
  onDeleted,
}: {
  channel: ChannelRecord;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const [detail, setDetail] = useState<StatusDetail | null>(null);
  const [login, setLogin] = useState<LoginInfo | null>(null);
  const [phase, setPhase] = useState<LoginPhase | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [pinnedCwds, setPinnedCwds] = useState<string[]>([]);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channel.id}/wechat/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusDetail;
      setDetail(data);
    } catch {
      // transient — the interval retries
    }
  }, [channel.id]);

  const loadWorkspaceOptions = useCallback(async () => {
    try {
      const [pinnedRes, sessionsRes] = await Promise.all([
        fetch("/api/pinned-cwds", { cache: "no-store" }),
        fetch("/api/sessions?limit=30", { cache: "no-store" }),
      ]);
      const pinned = (await pinnedRes.json().catch(() => ({ cwds: [] }))) as { cwds?: string[] };
      const sessions = (await sessionsRes.json().catch(() => ({ recentCwds: [] }))) as { recentCwds?: string[] };
      setPinnedCwds(pinned.cwds ?? []);
      setRecentCwds(sessions.recentCwds ?? []);
    } catch {
      // ignore
    }
  }, []);

  // Live status refresh.
  useEffect(() => {
    void refreshDetail();
    loadWorkspaceOptions();
    const id = setInterval(() => void refreshDetail(), 5000);
    return () => clearInterval(id);
  }, [refreshDetail, loadWorkspaceOptions]);

  // Login polling.
  useEffect(() => {
    if (!login || !login.sessionKey) return;
    if (
      phase === "confirmed" ||
      phase === "already_bound" ||
      phase === "expired" ||
      phase === "error" ||
      phase === "verify_blocked"
    ) {
      return;
    }

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/channels/${channel.id}/wechat/login?sessionKey=${encodeURIComponent(login.sessionKey)}`,
          { cache: "no-store" },
        );
        if (res.status === 410) {
          setPhase("expired");
          setPhaseMessage(t("channels.sessionExpired"));
          return;
        }
        const data = (await res.json()) as { phase: LoginPhase; message?: string };
        setPhase(data.phase);
        if (data.message) setPhaseMessage(data.message);
        if (data.phase === "confirmed") {
          await onChanged();
          await refreshDetail();
          toast.show({ kind: "success", message: t("channels.connected") });
          return;
        }
        if (data.phase === "already_bound") {
          toast.show({ kind: "error", message: t("channels.alreadyBound") });
          return;
        }
      } catch {
        // transient — keep polling
      }
      pollRef.current = setTimeout(tick, 2000);
    };
    pollRef.current = setTimeout(tick, 2000);

    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [login, phase, channel.id, onChanged, refreshDetail, toast, t]);

  // Close workspace menu on outside click.
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

  // When the channel record itself changes (rename / re-select elsewhere),
  // drop stale login state so we don't poll the wrong channel.
  useEffect(() => {
    setLogin(null);
    setPhase(null);
    setPhaseMessage(null);
    setConfirmingDelete(false);
    setRenaming(false);
    setNameDraft(channel.name);
  }, [channel.id, channel.name]);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setPhase("waiting");
    setPhaseMessage(null);
    try {
      const res = await fetch(`/api/channels/${channel.id}/wechat/login`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
        toast.show({ kind: "error", message: err.error || t("channels.loginFailed") });
        return;
      }
      const data = (await res.json()) as LoginInfo;
      setLogin(data);
      setPhase("waiting");
    } catch {
      toast.show({ kind: "error", message: t("channels.loginFailed") });
    } finally {
      setBusy(false);
    }
  }, [channel.id, toast, t]);

  const submitCode = useCallback(async () => {
    if (!login || !code.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/wechat/login/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: login.sessionKey, code: code.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
        toast.show({ kind: "error", message: err.error || t("channels.operationFailed") });
        return;
      }
      setCode("");
    } finally {
      setBusy(false);
    }
  }, [login, code, channel.id, toast, t]);

  const toggleEnabled = useCallback(async () => {
    if (!channel) return;
    setBusy(true);
    try {
      const enabled = channel.status === "disabled";
      const res = await fetch(`/api/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: enabled ? "connected" : "disabled" }),
      });
      if (!res.ok) {
        toast.show({ kind: "error", message: t("channels.operationFailed") });
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [channel, onChanged, toast, t]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      setWorkspaceMenuOpen(false);
      try {
        const res = await fetch(`/api/channels/${channel.id}/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({ error: "workspace_invalid" }))) as { error?: string };
          toast.show({ kind: "error", message: t(err.error ?? "channels.operationFailed") });
          return;
        }
        await onChanged();
        await refreshDetail();
        toast.show({ kind: "info", message: t("Workspace switched") });
      } catch (err) {
        toast.show({ kind: "error", message: String(err) });
      }
    },
    [channel.id, onChanged, refreshDetail, toast, t],
  );

  const startRename = useCallback(() => {
    setNameDraft(channel.name);
    setRenaming(true);
  }, [channel.name]);

  const saveRename = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === channel.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        toast.show({ kind: "error", message: t("channels.renameFailed") });
        return;
      }
      setRenaming(false);
      await onChanged();
      toast.show({ kind: "success", message: t("channels.renamed") });
    } finally {
      setBusy(false);
    }
  }, [nameDraft, channel.id, channel.name, onChanged, toast, t]);

  const deleteChannel = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.show({ kind: "error", message: t("channels.operationFailed") });
        return;
      }
      toast.show({ kind: "info", message: t("Channel deleted") });
      await onDeleted();
    } finally {
      setBusy(false);
    }
  }, [channel.id, onDeleted, toast, t]);

  const workspace = detail?.currentWorkspaceId ?? channel.workspaceId;
  const workspaceBroken = detail?.workspaceAvailable === false;
  const statusColor =
    channel.status === "connected" ? "var(--accent)"
      : channel.status === "expired" ? "#ef4444"
        : channel.status === "disabled" ? "var(--text-muted)"
          : "#f59e0b";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header: name + status */}
      <section style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
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
              }}
            />
            <button
              onClick={() => void saveRename()}
              disabled={busy || !nameDraft.trim()}
              style={{
                padding: "4px 12px",
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
                cursor: busy || !nameDraft.trim() ? "not-allowed" : "pointer",
                opacity: busy || !nameDraft.trim() ? 0.6 : 1,
              }}
            >
              {t("channels.save")}
            </button>
            <button
              onClick={() => setRenaming(false)}
              disabled={busy}
              style={{
                padding: "4px 12px",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                flexShrink: 0,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {t("channels.cancel")}
            </button>
          </>
        ) : (
          <>
            <strong style={{ color: "var(--text)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {channel.name}
            </strong>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {t(STATUS_LABEL_KEYS[channel.status])}
              {detail?.monitorRunning ? ` · ${t("channels.statusLive")}` : ""}
            </span>
            <button
              onClick={startRename}
              title={t("channels.rename")}
              style={{
                marginLeft: "auto",
                padding: "3px 10px",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11,
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              ✎ {t("channels.rename")}
            </button>
          </>
        )}
      </section>

      {/* Identity */}
      <section style={{ display: "flex", flexDirection: "column", gap: 4, padding: 12, borderRadius: 8, background: "var(--bg)", fontSize: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.channelId")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.id}</code>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.boundUser")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail?.userId ?? channel.userId ?? t("channels.notScanned")}</code>
          <span style={{ color: "var(--text-muted)" }}>{t("channels.accountId")}</span>
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail?.accountId ?? channel.accountId ?? "—"}</code>
        </div>
      </section>

      {/* Workspace */}
      <section ref={workspaceMenuRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "var(--bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("channels.currentWorkspace")}:</span>
          {workspace ? (
            <button
              onClick={() => setWorkspaceMenuOpen((v) => !v)}
              title={workspace}
              style={{
                flex: 1, minWidth: 0, background: "none", border: "none", padding: 0,
                color: workspaceBroken ? "#ef4444" : "var(--text)", fontSize: 12,
                fontFamily: "var(--font-mono)", textAlign: "left", cursor: "pointer",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {shortenPath(workspace)}
              {workspaceBroken ? ` (${t("channels.workspaceUnavailable")})` : ""}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("channels.notSet")}</span>
          )}
          <button
            onClick={() => setWorkspaceMenuOpen((v) => !v)}
            style={{
              background: "var(--bg-hover)", border: "1px solid var(--border)",
              color: "var(--text-muted)", borderRadius: 5, padding: "2px 8px",
              fontSize: 11, cursor: "pointer", flexShrink: 0,
            }}
          >
            {t("channels.switchWorkspace")}
          </button>
        </div>
        {workspaceMenuOpen && (
          <div
            data-scroll-inset
            style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4,
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)", maxHeight: 240, overflowY: "auto",
            }}
          >
            {pinnedCwds.length === 0 && recentCwds.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>{t("channels.noWorkspaces")}</div>
            ) : (
              <>
                {pinnedCwds.length > 0 && (
                  <>
                    <div style={{ padding: "6px 10px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase" }}>
                      {t("channels.pinned")}
                    </div>
                    {pinnedCwds.map((cwd) => (
                      <button
                        key={`p-${cwd}`}
                        onClick={() => switchWorkspace(cwd)}
                        title={cwd}
                        style={{
                          display: "block", width: "100%", padding: "6px 10px",
                          background: cwd === workspace ? "var(--bg-selected)" : "none",
                          border: "none", textAlign: "left", cursor: "pointer",
                          color: cwd === workspace ? "var(--text)" : "var(--text-muted)",
                          fontSize: 11, fontFamily: "var(--font-mono)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {shortenPath(cwd, 40)}
                      </button>
                    ))}
                  </>
                )}
                {recentCwds.length > 0 && (
                  <>
                    <div style={{
                      padding: "6px 10px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                      textTransform: "uppercase", borderTop: pinnedCwds.length > 0 ? "1px solid var(--border)" : "none",
                    }}>
                      {t("channels.recent")}
                    </div>
                    {recentCwds.map((cwd) => (
                      <button
                        key={`r-${cwd}`}
                        onClick={() => switchWorkspace(cwd)}
                        title={cwd}
                        style={{
                          display: "block", width: "100%", padding: "6px 10px",
                          background: cwd === workspace ? "var(--bg-selected)" : "none",
                          border: "none", textAlign: "left", cursor: "pointer",
                          color: cwd === workspace ? "var(--text)" : "var(--text-muted)",
                          fontSize: 11, fontFamily: "var(--font-mono)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {shortenPath(cwd, 40)}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Actions */}
      <section style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {channel.status === "connected" ? (
          <button
            onClick={() => void toggleEnabled()}
            disabled={busy}
            style={{ padding: "5px 12px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {t("channels.disable")}
          </button>
        ) : channel.status === "disabled" ? (
          <button
            onClick={() => void toggleEnabled()}
            disabled={busy}
            style={{ padding: "5px 12px", background: "var(--accent)", color: "var(--bg)", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {t("channels.enable")}
          </button>
        ) : null}
        {(channel.status === "pending" || channel.status === "expired") && (
          <button
            onClick={() => void startLogin()}
            disabled={busy}
            style={{ padding: "5px 12px", background: "var(--accent)", color: "var(--bg)", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {t("channels.scanToConnect")}
          </button>
        )}
        {channel.status === "connected" && (
          <button
            onClick={() => void startLogin()}
            disabled={busy}
            style={{ padding: "5px 12px", background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {t("channels.rescan")}
          </button>
        )}
        {confirmingDelete ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("channels.deleteChannelConfirm", { name: channel.name })}
            </span>
            <button
              onClick={() => void deleteChannel()}
              disabled={busy}
              style={{ padding: "5px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {t("channels.confirm")}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              style={{ padding: "5px 12px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {t("channels.cancel")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            style={{ marginLeft: "auto", padding: "5px 12px", background: "transparent", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
          >
            {t("channels.delete")}
          </button>
        )}
      </section>

      {/* Login flow */}
      {login && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", padding: 12, borderRadius: 8, background: "var(--bg)" }}>
          <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: "1px solid var(--border)" }}>
            <SmartImage src={login.qrDataUrl} alt="WeChat login QR" loaderSize={96} width={224} height={224} style={{ display: "block" }} />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5, textAlign: "center" }}>
            {t("channels.scanHint")}
          </p>
          <a
            href={login.qrUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}
          >
            {login.qrUrl}
          </a>

          {phase && (
            <div style={{ fontSize: 12, color: "var(--text)", padding: "4px 10px", background: "var(--bg-hover)", borderRadius: 4 }}>
              {t(PHASE_LABEL_KEYS[phase] ?? "channels.error")}
              {phaseMessage ? ` — ${t(phaseMessage)}` : ""}
            </div>
          )}

          {phase === "verifying" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("channels.pairingCode")}
                autoFocus
                style={{ width: 140, height: 28, padding: "4px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontSize: 13, fontFamily: "var(--font-mono)" }}
              />
              <button
                onClick={() => void submitCode()}
                disabled={busy || !code.trim()}
                style={{ padding: "4px 12px", background: "var(--accent)", color: "var(--bg)", border: "none", borderRadius: 4, fontSize: 12, cursor: busy || !code.trim() ? "not-allowed" : "pointer", opacity: busy || !code.trim() ? 0.5 : 1 }}
              >
                {t("channels.submit")}
              </button>
            </div>
          )}

          {(phase === "expired" || phase === "error" || phase === "verify_blocked") && (
            <button
              onClick={() => { setLogin(null); setPhase(null); setPhaseMessage(null); void startLogin(); }}
              disabled={busy}
              style={{ padding: "6px 14px", background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {t("channels.refreshQr")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}