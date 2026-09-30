"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Tooltip } from "@/components/ui/Tooltip";
import { PrimaryButton, SecondaryButton } from "./controls";
import { shortenPath } from "./skills-config/utils";
import { McpEntryCard } from "./mcp-config/McpEntryCard";
import { McpEntryForm } from "./mcp-config/McpEntryForm";
import {
  addDraftEntry,
  describedRemovals,
  describeStdioCommands,
  draftFromPanelData,
  isDraftDirty,
  mcpDraftProblem,
  mcpPendingChanges,
  withEntryConfig,
  withEntryRawJson,
  type McpDraft,
  type McpDraftEntry,
  type McpDraftProblem,
} from "@/lib/shared/mcp-draft";
import { MCP_SCOPES, type McpPanelData, type McpScope } from "@/lib/shared/mcp-panel";

/**
 * Modal for viewing and editing MCP servers — the two `mcp.json` files pi reads
 * (global `~/.pi/agent/mcp.json`, workspace `<cwd>/.pi/mcp.json`).
 *
 * Layout
 * ──────
 *   • List  — one section per file, mirroring how pi merges them: the global
 *     file first, then the workspace file whose entries can override it by
 *     name (both stay on disk, so both are shown, with a badge saying so).
 *     Each section carries the file's own switches (autoEnableCodemode) and its
 *     parse error, if any.
 *   • Entry — the clicked server's form (or, for a new one, an empty form).
 *   • Add   — no separate view: "+ Add server" appends a draft entry and opens
 *     it; a new entry also gets a scope picker.
 *
 * Saving is explicit: edits, additions and deletions live in a draft until the
 * one Save button writes them (see lib/shared/mcp-draft.ts). The confirmation
 * before that write lists every consequence — the entries that would be deleted
 * and the commands the next session would spawn — and nothing at all is written
 * if anything fails to validate (see lib/server/mcp-entries.ts).
 *
 * Servers connect when a *session* starts and pi has no hot-reload, so a save
 * only takes effect for new sessions; the footer says so and offers the action.
 */
export function McpConfig({
  cwd,
  onClose,
  onNewSession,
}: {
  cwd: string;
  onClose: () => void;
  onNewSession?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({ isOpen: true, onClose });

  const [data, setData] = useState<McpPanelData | null>(null);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [view, setView] = useState<{ kind: "list" } | { kind: "entry"; uid: string }>({ kind: "list" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      const payload = (await response.json()) as McpPanelData & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setData(payload);
      setDraft(draftFromPanelData(payload));
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = draft ? mcpDraftProblem(draft) : null;
  const dirty = data && draft ? isDraftDirty(draft, data) : false;
  const selectedEntry = draft && view.kind === "entry" ? draft.entries.find((entry) => entry.uid === view.uid) ?? null : null;

  const editEntry = useCallback((uid: string, edit: (entry: McpDraftEntry) => McpDraftEntry) => {
    setDraft((current) =>
      current ? { ...current, entries: current.entries.map((entry) => (entry.uid === uid ? edit(entry) : entry)) } : current,
    );
  }, []);

  const problemText = (value: McpDraftProblem | null): string | null => {
    if (!value) return null;
    switch (value.kind) {
      case "invalid-name":
        return t("mcp.problemInvalidName");
      case "duplicate-name":
        return t("mcp.problemDuplicateName", { name: value.name });
      case "not-an-object":
        return t("mcp.problemNotAnObject", { name: value.name });
      case "invalid-json":
        return t("mcp.problemInvalidJson", { name: value.name });
      case "missing-transport":
        return t("mcp.problemMissingTransport", { name: value.name });
    }
  };

  const closeSafe = useCallback(async () => {
    if (draft && data && isDraftDirty(draft, data)) {
      const ok = await confirm({
        title: t("mcp.discardTitle"),
        description: t("mcp.discardBody"),
        confirmLabel: t("mcp.discard"),
        cancelLabel: t("mcp.cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    requestClose();
  }, [confirm, data, draft, requestClose, t]);

  const save = useCallback(async () => {
    if (!data || !draft || problem) return;
    const changes = mcpPendingChanges(draft, data);
    if (changes.length === 0) return;

    // One gate for every consequence of this write.
    const gates: string[] = [];
    const removals = describedRemovals(changes);
    if (removals.length > 0) gates.push(t("mcp.confirmRemove", { names: removals.join(", ") }));
    const commands = describeStdioCommands(changes);
    if (commands.length > 0) gates.push(t("mcp.confirmSpawn", { commands: commands.join("\n") }));
    if (gates.length > 0) {
      const ok = await confirm({
        title: t("mcp.confirmSaveTitle"),
        description: gates.join("\n\n"),
        confirmLabel: t("mcp.save"),
        cancelLabel: t("mcp.cancel"),
        destructive: false,
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, changes }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      await load();
      setView({ kind: "list" });
      setSavedOnce(true);
      toast.show({ kind: "success", message: t("mcp.saved") });
    } catch (e) {
      toast.show({ kind: "error", message: t("mcp.saveFailed", { error: String(e) }) });
    } finally {
      setSaving(false);
    }
  }, [confirm, cwd, data, draft, load, problem, t, toast]);

  const startAdd = useCallback(() => {
    if (!draft) return;
    const added = addDraftEntry(draft, "global");
    setDraft(added.draft);
    setView({ kind: "entry", uid: added.uid });
  }, [draft]);

  const autoEnable = (scope: McpScope, next: boolean) => {
    setDraft((current) => (current ? { ...current, autoEnableCodemode: { ...current.autoEnableCodemode, [scope]: next } } : current));
  };

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{t("mcp.title")}</span>
        <code
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortenPath(cwd)}
        </code>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          onClick={startAdd}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            fontSize: 12.5,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("mcp.add")}
        </button>
        <button
          onClick={() => void closeSafe()}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}
        >
          ×
        </button>
      </div>
    </div>
  );

  const backHeader = (label: ReactNode, onClick: () => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 18px 12px", flexShrink: 0 }}>
      <button
        onClick={onClick}
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t("mcp.title")}
      </button>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );

  const scopeLabel = (scope: McpScope) => t(scope === "global" ? "mcp.global" : "mcp.project");

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) void closeSafe();
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: 860,
          height: "78vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {header}

        {selectedEntry ? (
          <>
            {backHeader(
              <>
                {selectedEntry.name || t("mcp.noName")}
                <span style={{ color: "var(--text-dim)", fontWeight: 400 }}> · {scopeLabel(selectedEntry.scope)}</span>
              </>,
              () => setView({ kind: "list" }),
            )}
            <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "0 18px 18px" }}>
              <div style={{ maxWidth: 620 }}>
                {selectedEntry.originalName === null && (
                  <ScopePicker
                    value={selectedEntry.scope}
                    projectDisabled={!data?.projectTrusted}
                    onChange={(scope) => editEntry(selectedEntry.uid, (entry) => ({ ...entry, scope }))}
                  />
                )}
                <McpEntryForm
                  key={selectedEntry.uid}
                  entry={selectedEntry}
                  onNameChange={(name) => editEntry(selectedEntry.uid, (entry) => ({ ...entry, name }))}
                  onConfigChange={(config) => editEntry(selectedEntry.uid, (entry) => withEntryConfig(entry, config))}
                  onRawJsonChange={(text) => editEntry(selectedEntry.uid, (entry) => withEntryRawJson(entry, text))}
                />
                <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10 }}>
                  {selectedEntry.originalName === null ? (
                    <SecondaryButton
                      onClick={() => {
                        setDraft((current) =>
                          current
                            ? { ...current, entries: current.entries.filter((entry) => entry.uid !== selectedEntry.uid) }
                            : current,
                        );
                        setView({ kind: "list" });
                      }}
                    >
                      {t("mcp.delete")}
                    </SecondaryButton>
                  ) : selectedEntry.deleted ? (
                    <SecondaryButton onClick={() => editEntry(selectedEntry.uid, (entry) => ({ ...entry, deleted: false }))}>
                      {t("mcp.undoDelete")}
                    </SecondaryButton>
                  ) : (
                    <SecondaryButton onClick={() => editEntry(selectedEntry.uid, (entry) => ({ ...entry, deleted: true }))}>
                      {t("mcp.delete")}
                    </SecondaryButton>
                  )}
                  {selectedEntry.deleted && <span style={{ fontSize: 11, color: "var(--error)" }}>{t("mcp.deleteHint")}</span>}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "2px 18px 18px" }}>
            {loading ? (
              <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
            ) : loadError ? (
              <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--error)" }}>{t("mcp.loadFailed", { error: loadError })}</div>
            ) : !data || !draft ? null : (
              <>
                {!data.projectTrusted && <Notice tone="warn">{t("mcp.untrusted")}</Notice>}
                {data.errors.length > 0 && (
                  <Notice tone="error">
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("mcp.errorsTitle", { count: data.errors.length })}</div>
                    {data.errors.slice(0, 6).map((error, index) => (
                      <div key={`${error}-${index}`} style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {error}
                      </div>
                    ))}
                    {data.errors.length > 6 && <div style={{ marginTop: 2 }}>+{data.errors.length - 6}</div>}
                  </Notice>
                )}

                {MCP_SCOPES.map((scope) => {
                  const file = data.files.find((item) => item.scope === scope);
                  const entries = draft.entries.filter((entry) => entry.scope === scope);
                  if (!file) return null;
                  return (
                    <section key={scope} style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 10px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {scopeLabel(scope)}
                        </span>
                        <code
                          style={{
                            fontSize: 11,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 380,
                          }}
                        >
                          {shortenPath(file.path)}
                        </code>
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{entries.length}</span>
                        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Tooltip content={t("mcp.autoEnableCodemodeHint")} side="top">
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("mcp.autoEnableCodemode")}</span>
                          </Tooltip>
                          <ToggleSwitch
                            size="sm"
                            on={draft.autoEnableCodemode[scope]}
                            disabled={!file.exists && entries.length === 0}
                            onChange={(next) => autoEnable(scope, next)}
                            label={t("mcp.autoEnableCodemode")}
                          />
                        </span>
                      </div>

                      {file.parseError ? (
                        <Notice tone="error">{t("mcp.fileError", { error: file.parseError })}</Notice>
                      ) : !file.exists ? (
                        <div style={{ padding: "0 2px", fontSize: 12, color: "var(--text-dim)" }}>{t("mcp.fileMissing")}</div>
                      ) : entries.length === 0 ? (
                        <div style={{ padding: "0 2px", fontSize: 12, color: "var(--text-dim)" }}>{t("mcp.empty")}</div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                          {entries.map((entry) => (
                            <McpEntryCard
                              key={entry.uid}
                              entry={entry}
                              onOpen={() => setView({ kind: "entry", uid: entry.uid })}
                              onToggleEnabled={(enabled) =>
                                editEntry(entry.uid, (current) =>
                                  current.config ? withEntryConfig(current, { ...current.config, enabled }) : current,
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", flexShrink: 0 }}>
          {problemText(problem) ? (
            <span style={{ flex: 1, fontSize: 12, color: "var(--error)" }}>{problemText(problem)}</span>
          ) : savedOnce ? (
            <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>{t("mcp.applyHint")}</span>
          ) : (
            <span style={{ flex: 1 }} />
          )}
          {savedOnce && onNewSession && (
            <SecondaryButton
              onClick={() => {
                onNewSession();
                requestClose();
              }}
            >
              {t("mcp.newSession")}
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => void save()} disabled={!dirty || !!problem || saving}>
            {saving ? t("mcp.saving") : t("mcp.save")}
          </PrimaryButton>
          <SecondaryButton onClick={() => void closeSafe()}>{t("mcp.close")}</SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  const color = tone === "error" ? "var(--error)" : "var(--text-muted)";
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        color,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        borderRadius: 6,
        padding: "8px 10px",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function ScopePicker({
  value,
  projectDisabled,
  onChange,
}: {
  value: McpScope;
  projectDisabled: boolean;
  onChange: (scope: McpScope) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("mcp.transport")} style={{ display: "flex", gap: 6, marginBottom: 14 }}>
      {MCP_SCOPES.map((scope) => {
        const disabled = scope === "project" && projectDisabled;
        const active = scope === value;
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? t("mcp.untrusted") : undefined}
            onClick={() => onChange(scope)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 6,
              background: active ? "var(--accent)" : "var(--bg)",
              border: "1px solid var(--border)",
              color: active ? "#fff" : "var(--text)",
              fontSize: 13,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {t(scope === "global" ? "mcp.global" : "mcp.project")}
          </button>
        );
      })}
    </div>
  );
}
