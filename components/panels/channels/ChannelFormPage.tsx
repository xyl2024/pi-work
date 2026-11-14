"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { fetchRecentCwds } from "@/lib/client/channels-io";
import {
  createChannelInStore,
  discardChannelForm,
  setChannelWorkspaceDraft,
  setChannelsNameDraft,
  useChannelsPanel,
} from "@/lib/client/channels-panel";

function shortenPath(p: string, max = 44): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}

export function ChannelFormPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { view } = useChannelsPanel();
  const { nameDraft, workspaceDraft, busy } = view;
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchRecentCwds().then(setRecentCwds);
  }, []);

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

  async function create() {
    const result = await createChannelInStore();
    if (!result.ok) toast.show({ kind: "error", message: t("channels.operationFailed") });
  }

  const canCreate = !busy && nameDraft.trim().length > 0;

  return (
    <div style={{ height: "100%", minHeight: 0, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }} htmlFor="channel-name">
          {t("channels.channelName")}
        </label>
        <input
          id="channel-name"
          value={nameDraft}
          onChange={(e) => setChannelsNameDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canCreate) void create(); }}
          autoFocus
          maxLength={50}
          style={{ padding: "7px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit" }}
        />
      </div>

      <div ref={workspaceMenuRef} style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("channels.workspace")}</span>
        <button
          type="button"
          onClick={() => setWorkspaceMenuOpen((v) => !v)}
          title={workspaceDraft ?? undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg)", color: workspaceDraft ? "var(--text)" : "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {workspaceDraft ? shortenPath(workspaceDraft) : t("channels.notSet")}
        </button>
        {workspaceMenuOpen && (
          <div
            data-scroll-inset
            style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "var(--elevation-prominent)", maxHeight: 240, overflowY: "auto" }}
          >
            {recentCwds.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>{t("channels.noWorkspaces")}</div>
            ) : (
              recentCwds.map((cwd) => (
                <button
                  key={cwd}
                  type="button"
                  onClick={() => {
                    setChannelWorkspaceDraft(cwd);
                    setWorkspaceMenuOpen(false);
                  }}
                  title={cwd}
                  style={{ display: "block", width: "100%", padding: "6px 10px", background: cwd === workspaceDraft ? "var(--bg-selected)" : "none", border: "none", textAlign: "left", cursor: "pointer", color: cwd === workspaceDraft ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {shortenPath(cwd, 44)}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void create()}
          disabled={!canCreate}
          style={{ padding: "7px 16px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: canCreate ? "pointer" : "not-allowed", opacity: canCreate ? 1 : 0.6 }}
        >
          {busy ? t("channels.creating") : t("Create")}
        </button>
        <button
          type="button"
          onClick={discardChannelForm}
          disabled={busy}
          style={{ padding: "7px 16px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13, fontFamily: "inherit", cursor: busy ? "not-allowed" : "pointer" }}
        >
          {t("channels.discard")}
        </button>
      </div>
    </div>
  );
}
