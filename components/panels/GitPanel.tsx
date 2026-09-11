"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { RefreshIconButton } from "../ui/RefreshIconButton";
import type { GitStatusResponse } from "@/lib/shared/git-diff-types";
import { GitDiffView } from "./GitDiffView";
import { GitLogView } from "./GitLogView";

interface Props {
  cwd: string | null;
  /** Changes whenever the panel is opened, so opening it refreshes status. */
  openRefreshToken?: number;
  /** Called when the Log view becomes active so the shell can widen the
   *  right panel (same "expanded" state the Canvas panel uses). */
  onExpandPanel?: () => void;
  /** Whether the host right panel is currently expanded. */
  isPanelExpanded?: boolean;
}

type Mode = "diff" | "log";

/**
 * Git panel: the single entry rendered by the AppShell tab bar for a repo.
 * Owns the shared header (repo info + branch dropdown + Diff/Log mode
 * toggle + refresh) and delegates the rest to two self-contained views:
 *   - GitDiffView — worktree / staged changes
 *   - GitLogView  — branch-aware commit history + commit file diffs
 */
export function GitPanel({ cwd, openRefreshToken = 0, onExpandPanel, isPanelExpanded = false }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("diff");
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Log-mode state: branch dropdown options + the selected branch.
  // `branch: null` means "current HEAD" (also covers detached HEAD).
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  // Bumped by the refresh button; GitLogView resets to page 1 on change.
  const [refreshToken, setRefreshToken] = useState(0);

  const loadStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error === "cwd_not_allowed" ? t("Not allowed") : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GitStatusResponse;
      setStatus(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.show({ kind: "error", message: msg || t("Refresh") });
    } finally {
      setLoading(false);
    }
  }, [cwd, toast, t]);

  const loadBranches = useCallback(async () => {
    if (!cwd) return;
    setBranchLoading(true);
    try {
      const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { branches: string[] };
      setBranches(data.branches);
    } catch {
      // Best-effort: the log list still works on HEAD without the dropdown.
    } finally {
      setBranchLoading(false);
    }
  }, [cwd]);

  // Reset + load the overview when the cwd changes, on mount, or when the
  // panel is opened again. This keeps the status fresh after changes made
  // while the panel was closed.
  useEffect(() => {
    setStatus(null);
    setError(null);
    setBranches(null);
    setBranch(null);
    setRefreshToken((n) => n + 1);
    if (cwd) void loadStatus();
  }, [cwd, loadStatus, openRefreshToken]);

  // Lazy-load the branch list the first time Log mode is entered.
  useEffect(() => {
    if (mode === "log" && cwd && branches === null) void loadBranches();
  }, [mode, cwd, branches, loadBranches]);

  // Switching to the Log view widens the panel.
  // Fires only on the diff→log transition (mode starts as "diff"), so
  // session switches while already in Log mode don't re-expand.
  useEffect(() => {
    if (mode === "log") onExpandPanel?.();
  }, [mode, onExpandPanel]);

  const handleRefresh = useCallback(() => {
    if (!cwd) return;
    void loadStatus();
    if (mode === "log") {
      setBranches(null);
      void loadBranches();
      setRefreshToken((n) => n + 1);
    }
  }, [cwd, mode, loadStatus, loadBranches]);

  const busy = loading || branchLoading;
  const repoName = status?.repoRoot ? status.repoRoot.split("/").pop() || status.repoRoot : null;
  // Selection shown in the header dropdown = explicit pick, else current checkout.
  const activeBranch = branch ?? status?.branch ?? null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "transparent",
    }}>
      {/* Header: repo info + branch dropdown + mode toggle + refresh */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px",
        flexShrink: 0,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M6 9v6" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        {status?.repoRoot ? (
          <span style={{
            fontSize: 12, color: "var(--text)", fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {status.branch ? (
              <span style={{ color: "var(--accent)" }}>{status.branch}</span>
            ) : null}
            {status.branch ? " · " : ""}
            {repoName}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Git Diff")}</span>
        )}
        <div style={{ flex: 1 }} />

        {/* Branch dropdown — Log mode only, has no effect on Diff status */}
        {mode === "log" && status?.repoRoot && (
          <select
            value={activeBranch ?? ""}
            onChange={(e) => setBranch(e.target.value || null)}
            disabled={branchLoading || !branches}
            title={t("Branch")}
            style={{
              maxWidth: 120, fontSize: 11, padding: "2px 4px",
              background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 5,
              cursor: (branchLoading || !branches) ? "not-allowed" : "pointer",
            }}
          >
            {!status.branch && <option value="">(HEAD)</option>}
            {(branches ?? []).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}

        {/* Diff / Log mode toggle */}
        {(["diff", "log"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "3px 10px", fontSize: 11, borderRadius: 6,
              border: "1px solid var(--border)",
              background: mode === m ? "var(--bg-selected)" : "var(--bg)",
              color: mode === m ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: mode === m ? 600 : 400,
            }}
          >
            {m === "diff" ? t("Diff") : t("Log")}
          </button>
        ))}

        <RefreshIconButton
          onClick={handleRefresh}
          disabled={!cwd || busy}
          label={t("Refresh")}
          // Visually aligned with the bordered Diff/Log mode toggles
          // directly to the left.
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            opacity: (!cwd || busy) ? 0.5 : 1,
            cursor: (!cwd || busy) ? "not-allowed" : "pointer",
          }}
          iconStyle={{ animation: busy ? "spin 0.9s linear infinite" : undefined }}
        />
      </div>

      {/* Body — shared states live here; ready state delegates to the view */}
      {!cwd ? (
        <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
          {t("Open a session first")}
        </div>
      ) : loading && !status ? (
        <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
          {t("Loading…")}
        </div>
      ) : error ? (
        <div style={{ padding: "24px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</div>
          <button
            onClick={() => void loadStatus()}
            style={{
              padding: "4px 12px", fontSize: 12,
              background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
            }}
          >
            {t("Retry")}
          </button>
        </div>
      ) : !status ? (
        <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
          {t("Loading…")}
        </div>
      ) : !status.repoRoot ? (
        <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
          {t("Not a git repository")}
        </div>
      ) : mode === "diff" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <GitDiffView cwd={cwd} status={status} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <GitLogView
            cwd={cwd}
            branch={branch}
            refreshToken={refreshToken}
            showDetail={isPanelExpanded}
            onCommitSelected={onExpandPanel}
          />
        </div>
      )}
    </div>
  );
}