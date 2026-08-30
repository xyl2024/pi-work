/**
 * WorkflowsModal — top-level workflow manager dialog.
 *
 * Left: workflow list. Right: selected workflow's header + run history with
 * an inline per-node breakdown. Create/edit lives in WorkflowEditorModal.
 *
 * Polls the selected workflow's run list while any run is still in flight so
 * the panel stays live without a dedicated SSE channel (Phase 3 may add one).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "@/components/ui/Toast";
import { CloseIcon } from "@/components/ui/icons";
import { WorkflowEditorModal } from "./WorkflowEditorModal";
import { apiFetch, formatDuration, formatRelative, nodeColor, runColor } from "./utils";
import type { Workflow, WorkflowRun, WorkflowRunNode, WorkflowRunStatus } from "@/lib/shared/workflow";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}

interface RunDetail {
  run: WorkflowRun;
  nodes: WorkflowRunNode[];
}

export function WorkflowsModal({ open, onClose, onOpenSession }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail | null>>({});
  const [now, setNow] = useState(Date.now());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ workflows: Workflow[] }>("/api/workflows");
      setWorkflows(data.workflows ?? []);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to load") });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (open) {
      void loadWorkflows();
      setSelectedId(null);
      setRuns([]);
      setRunDetails({});
      setNow(Date.now());
    }
  }, [open, loadWorkflows]);

  // Time ticker + polling while any visible workflow run is in flight.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    pollTimer.current = timer;
    return () => clearInterval(timer);
  }, [open]);

  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!open || !selectedId || !anyRunning) return;
    const id = setInterval(() => void loadRuns(selectedId, false), 3000);
    return () => clearInterval(id);
  }, [open, selectedId, anyRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedId ? workflows.find((w) => w.id === selectedId) ?? null : null;

  const loadRuns = useCallback(async (workflowId: string, showSpinner: boolean) => {
    if (showSpinner) setRunsLoading(true);
    try {
      const data = await apiFetch<{ runs: WorkflowRun[] }>(`/api/workflows/${encodeURIComponent(workflowId)}/runs`);
      setRuns(data.runs ?? []);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to load") });
    } finally {
      if (showSpinner) setRunsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (open && selectedId) void loadRuns(selectedId, true);
  }, [open, selectedId, loadRuns]);

  const toggleNode = useCallback(async (runId: string) => {
    if (runDetails[runId] !== undefined) {
      setRunDetails((prev) => ({ ...prev, [runId]: prev[runId] ?? null }));
      return;
    }
    try {
      const detail = await apiFetch<RunDetail>(`/api/workflows/runs/${encodeURIComponent(runId)}`);
      setRunDetails((prev) => ({ ...prev, [runId]: detail }));
    } catch {
      setRunDetails((prev) => ({ ...prev, [runId]: null }));
    }
  }, [runDetails]);

  const handleRun = useCallback(async (workflow: Workflow) => {
    try {
      const data = await apiFetch<{ runId: string }>(`/api/workflows/${encodeURIComponent(workflow.id)}/run`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.show({ kind: "success", message: t("Workflow triggered") });
      void loadWorkflows();
      void loadRuns(workflow.id, false);
      if (data.runId) void toggleNode(data.runId).then(() => setRunDetails((prev) => ({ ...prev, [data.runId]: prev[data.runId] })));
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to trigger workflow") });
    }
  }, [t, toast, loadWorkflows, loadRuns, toggleNode]);

  const handleToggleEnabled = useCallback(async (workflow: Workflow) => {
    try {
      const data = await apiFetch<{ workflow: Workflow }>("/api/workflows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workflow.id, enabled: workflow.enabled }),
      });
      setWorkflows((prev) => prev.map((w) => (w.id === workflow.id ? data.workflow : w)));
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to toggle workflow") });
    }
  }, [t, toast]);

  const handleDelete = useCallback(async (workflow: Workflow) => {
    try {
      await apiFetch(`/api/workflows?id=${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
      toast.show({ kind: "success", message: t("Workflow deleted") });
      if (selectedId === workflow.id) setSelectedId(null);
      await loadWorkflows();
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Delete failed") });
    }
  }, [t, toast, selectedId, loadWorkflows]);

  const openEditor = (workflow: Workflow | null) => { setEditing(workflow); setEditorOpen(true); };

  const onSaved = useCallback(() => {
    setEditorOpen(false);
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editorOpen) { setEditorOpen(false); return; }
      requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, editorOpen, requestClose]);

  if (!isVisible) return null;

  return (
    <div style={backdropStyle} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, width: 940, maxWidth: "96vw", height: "84vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Workflows")}</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{workflows.length > 0 ? t("{n} workflows", { n: workflows.length }) : ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => openEditor(null)} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {t("New workflow")}
            </button>
            <button onClick={requestClose} aria-label={t("Close")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* List */}
          <div style={{ width: 300, borderRight: "1px solid var(--border)", overflowY: "auto", flexShrink: 0 }}>
            {loading && workflows.length === 0 ? (
              <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12 }}>{t("Loading...")}</div>
            ) : workflows.length === 0 ? (
              <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12 }}>{t("No workflows yet")}</div>
            ) : (
              workflows.map((wf) => {
                const active = wf.id === selectedId;
                return (
                  <div key={wf.id} onClick={() => setSelectedId(wf.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: active ? "var(--bg-selected)" : "transparent", cursor: "pointer" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: active ? 700 : 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{wf.name}</span>
                        <StatusDot status={wf.lastRunStatus ?? null} />
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{wf.triggerType === "cron" ? (wf.enabled ? t("Cron") : t("Paused")) : t("Manual")}</span>
                        {wf.nodes.length > 0 && <span>· {wf.nodes.length} {t("nodes")}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail */}
          {selected ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* workflow header */}
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{selected.name}</span>
                      <WorkflowStatusBadge wf={selected} t={t} />
                    </div>
                    {selected.description && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{selected.description}</div>}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>{t("cwd")}: {selected.cwd}</span>
                      <span>{t("nodes")}: {selected.nodes.length}</span>
                      {selected.triggerType === "cron" && <span>{t("Cron")}: {selected.cron ?? "—"}</span>}
                      {selected.lastRunAt != null && <span>{t("Last run")}: {formatRelative(now, selected.lastRunAt)}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {selected.triggerType === "cron" && (
                      <button onClick={() => handleToggleEnabled({ ...selected, enabled: !selected.enabled })} style={ghost}>{selected.enabled ? t("Pause") : t("Enable")}</button>
                    )}
                    <button onClick={() => handleRun(selected)} style={primary}>{t("Run now")}</button>
                    <button onClick={() => openEditor(selected)} style={ghost}>{t("Edit")}</button>
                    <button onClick={() => handleDelete(selected)} style={ghostDanger}>{t("Delete")}</button>
                  </div>
                </div>
              </div>

              {/* nodes overview */}
              <NodesOverview nodes={selected.nodes} t={t} />

              {/* runs history */}
              <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
                <div style={{ padding: "8px 18px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {t("Run history")}
                </div>
                {runsLoading && runs.length === 0 ? (
                  <div style={{ padding: "0 18px", color: "var(--text-dim)", fontSize: 12 }}>{t("Loading...")}</div>
                ) : runs.length === 0 ? (
                  <div style={{ padding: "0 18px", color: "var(--text-muted)", fontSize: 12 }}>{t("No runs yet")}</div>
                ) : (
                  runs.map((run) => (
                    <RunRow key={run.id} run={run} now={now} t={t} detail={runDetails[run.id] ?? undefined} collapsed={runDetails[run.id] === null} onToggle={() => toggleNode(run.id)} onOpenSession={onOpenSession} />
                  ))
                )}
              </div>
            </div>
          ) : (
            <EmptyDetail loading={loading && workflows.length === 0} t={t} />
          )}
        </div>
      </div>

      {editorOpen && (
        <WorkflowEditorModal open={editorOpen} workflow={editing} onClose={() => setEditorOpen(false)} onSaved={onSaved} onToast={(kind, message) => toast.show({ kind, message })} />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: WorkflowRunStatus | null }) {
  if (!status) return null;
  const c = runColor(status);
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.fg, flexShrink: 0 }} />;
}

function WorkflowStatusBadge({ wf, t }: { wf: Workflow; t: (k: string) => string }) {
  if (wf.triggerType !== "cron") return null;
  const c = runColor(wf.enabled ? "success" : "failed");
  return <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, color: c.fg, background: c.bg, border: `1px solid ${c.fg}` }}>{wf.enabled ? t("cron on") : t("paused")}</span>;
}

function NodesOverview({ nodes, t }: { nodes: Workflow["nodes"]; t: (k: string) => string }) {
  if (nodes.length === 0) {
    return (
      <div style={{ padding: "10px 18px", fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
        {t("No nodes yet — add steps in Edit")}
      </div>
    );
  }
  return (
    <div style={{ borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 8, padding: "10px 18px", alignItems: "center" }}>
        {nodes.map((node) => (
          <div key={node.id} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 700 }}>{node.name}</span>
            {node.dependsOn.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>↑{node.dependsOn.length}</span>}
            {node.failurePolicy === "skip" && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>{t("skip on fail")}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunRow({ run, now, t, detail, collapsed, onToggle, onOpenSession }: {
  run: WorkflowRun; now: number; t: (k: string) => string;
  detail?: RunDetail; collapsed: boolean;
  onToggle: () => void; onOpenSession: (s: string) => void;
}) {
  const c = runColor(run.status);
  const running = run.status === "running";
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", cursor: "pointer", background: detail || collapsed || running ? "var(--bg-subtle)" : "transparent" }}>
        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, color: c.fg, background: c.bg, width: 62, textAlign: "center" }}>{run.status}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{run.trigger === "cron" ? t("Cron") : t("Manual")}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatRelative(now, run.startedAt)}</span>
        {run.endedAt != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDuration(run.endedAt - run.startedAt)}</span>}
        <span style={{ flex: 1 }} />
        {running && <span style={{ fontSize: 11, color: "var(--info)" }}>…</span>}
      </div>
      {running && <div style={{ padding: "2px 18px 10px", fontSize: 11, color: "var(--text-muted)" }}>{t("Polling for updates...")}</div>}
      {!running && detail && detail.run.id === run.id && (
        <div style={{ padding: "2px 18px 12px" }}>
          {detail.run.error && <div style={{ fontSize: 12, color: "var(--error)", marginBottom: 8, whiteSpace: "pre-wrap" }}>{detail.run.error}</div>}
          {detail.nodes.map((n) => {
            const nc = nodeColor(n.status);
            return (
              <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderLeft: `2px solid ${nc.fg}`, paddingLeft: 10, marginLeft: 4 }}>
                <div style={{ maxWidth: "30%" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{n.nodeId}</div>
                  <div style={{ fontSize: 11, color: nc.fg }}>{n.status}{n.attempts > 1 ? ` ×${n.attempts}` : ""}</div>
                  {n.sessionId && <button onClick={() => onOpenSession(n.sessionId!)} style={{ fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>{t("Open session")}</button>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.renderInput && <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", marginBottom: 4 }}>{n.renderInput.slice(0, 200)}</div>}
                  {n.replyText && <div style={{ fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", opacity: 0.9 }}>{n.replyText.slice(0, 300)}</div>}
                  {n.error && <div style={{ fontSize: 11, color: "var(--error)", whiteSpace: "pre-wrap" }}>{n.error.slice(0, 300)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyDetail({ loading, t }: { loading: boolean; t: (k: string) => string }) {
  if (loading) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("Loading...")}</div>;
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 13, marginBottom: 6, color: "var(--text)" }}>{t("Select a workflow from the list on the left")}</div>
        <div style={{ fontSize: 11 }}>{t("or create a new workflow")}</div>
      </div>
    </div>
  );
}

// Shared button styles (kept local to avoid cross-module style import).
const primary: React.CSSProperties = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const ghost: React.CSSProperties = { background: "var(--bg-hover)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const ghostDanger: React.CSSProperties = { ...ghost, color: "var(--error)" };