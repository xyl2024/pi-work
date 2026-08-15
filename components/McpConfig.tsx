"use client";

import { useModalAnimation } from "@/hooks/useModalAnimation";

/**
 * Independent modal — `Open MCP servers`.
 *
 * Shape mirrors `ModelsConfig.tsx`: a centered overlay (78vh) with a
 * top-level header and a body that uses the same backdrop-click + ESC
 * close behaviour. Internal state owns config form, server selection,
 * selected tool, raw arguments text, and the most recent call result.
 *
 * Does NOT touch `lib/rpc-manager.ts` / `createAgentSession`. v1 is a
 * standalone MCP test bench. v2 (agent integration) is a separate
 * design doc.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "./Toast";
import { useMcpClient, type McpServerView } from "@/hooks/useMcpClient";

type Transport = "stdio" | "http";

interface ServerFormState {
  // raw user input — both Add and Edit reuse this
  name: string;
  enabled: boolean;
  transport: Transport;
  // stdio fields
  command: string;
  args: string;
  envText: string;
  cwd: string;
  // http fields
  url: string;
  headersText: string;
  timeout_ms: string;
}

function blankForm(): ServerFormState {
  return {
    name: "",
    enabled: true,
    transport: "stdio",
    command: "",
    args: "",
    envText: "",
    cwd: "",
    url: "",
    headersText: "",
    timeout_ms: "",
  };
}

interface ServerFormProps {
  initial: ServerFormState;
  isEdit: boolean;
  /** Slug conflict with existing servers (other than this one if editing). */
  nameConflict: boolean;
  onSave: (state: ServerFormState) => Promise<void>;
  onCancel: () => void;
}

function ServerForm({ initial, isEdit, nameConflict, onSave, onCancel }: ServerFormProps) {
  const [state, setState] = useState<ServerFormState>(initial);
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof ServerFormState>(key: K, value: ServerFormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(state);
    } finally {
      setBusy(false);
    }
  };

  // On transport switch, only the relevant fields survive in the form
  // view; the Save handler converts text into structured values.
  const isStdio = state.transport === "stdio";

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 12,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-subtle)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          <span>name</span>
          <input
            value={state.name}
            disabled={isEdit}
            onChange={(e) => update("name", e.target.value)}
            placeholder="filesystem"
            style={{
              padding: "6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
            }}
          />
          {nameConflict && (
            <span style={{ fontSize: 11, color: "var(--accent)" }}>
              {t("A server with this name already exists.")}
            </span>
          )}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          <span>transport</span>
          <select
            value={state.transport}
            onChange={(e) => update("transport", e.target.value as Transport)}
            style={{
              padding: "6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
            }}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </label>
        {isStdio ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>command</span>
              <input
                value={state.command}
                onChange={(e) => update("command", e.target.value)}
                placeholder="npx"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>args (whitespace-separated)</span>
              <input
                value={state.args}
                onChange={(e) => update("args", e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>env (one KEY=VALUE per line, supports $&#123;VAR&#125;)</span>
              <textarea
                value={state.envText}
                onChange={(e) => update("envText", e.target.value)}
                placeholder={"DEBUG=1"}
                style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "var(--font-mono)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>cwd (optional)</span>
              <input
                value={state.cwd}
                onChange={(e) => update("cwd", e.target.value)}
                placeholder="/home/alone"
                style={inputStyle}
              />
            </label>
          </>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>url</span>
              <input
                value={state.url}
                onChange={(e) => update("url", e.target.value)}
                placeholder="https://mcp.example.com"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
              <span>headers (one Key: Value per line, supports $&#123;VAR&#125;)</span>
              <textarea
                value={state.headersText}
                onChange={(e) => update("headersText", e.target.value)}
                placeholder={"Authorization: Bearer ${MCP_TOKEN}"}
                style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "var(--font-mono)" }}
              />
            </label>
          </>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          <span>timeout_ms (optional)</span>
          <input
            value={state.timeout_ms}
            onChange={(e) => update("timeout_ms", e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="30000"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", marginTop: 18 }}>
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
          />
          <span>enabled</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={secondaryButtonStyle}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || nameConflict || !state.name.trim()}
          style={{
            ...primaryButtonStyle,
            opacity: busy || nameConflict || !state.name.trim() ? 0.5 : 1,
          }}
        >
          {isEdit ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}

// Hoisted out of components for stable references that don't recreate
// on every keystroke.
const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--font-mono)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  border: "1px solid var(--accent)",
  borderRadius: 4,
  background: "var(--accent)",
  color: "var(--bg)",
  fontSize: 13,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
};

const t = (key: string): string => key; // Placeholder so the unhooked
                                        // ServerForm renders in dev tools
                                        // that don't traverse the tree.
                                        // The real `t` lives in the
                                        // outer component below.

// ──────────────────────────────────────────────────────────────────────
// Main modal
// ──────────────────────────────────────────────────────────────────────

// We keep the union-ed ServerFormState entry type loose because the
// UI only round-trips the few text fields we surface.
interface RawServerEntry {
  name?: string;
  enabled?: boolean;
  transport?: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
}

function fromRawServer(raw: RawServerEntry): ServerFormState {
  const base = blankForm();
  return {
    ...base,
    name: typeof raw.name === "string" ? raw.name : "",
    enabled: raw.enabled !== false,
    transport: raw.transport === "http" ? "http" : "stdio",
    command: typeof raw.command === "string" ? raw.command : "",
    args: Array.isArray(raw.args) ? raw.args.join(" ") : "",
    envText: raw.env ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
    cwd: typeof raw.cwd === "string" ? raw.cwd : "",
    url: typeof raw.url === "string" ? raw.url : "",
    headersText: raw.headers
      ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "",
    timeout_ms: typeof raw.timeout_ms === "number" ? String(raw.timeout_ms) : "",
  };
}

function parseKeyValueText(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(sep);
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key.length > 0) out[key] = value;
  }
  return out;
}

function formToEntry(form: ServerFormState): RawServerEntry {
  const entry: RawServerEntry = {
    name: form.name.trim(),
    enabled: form.enabled,
    transport: form.transport,
  };
  const timeout = Number(form.timeout_ms);
  if (Number.isInteger(timeout) && timeout > 0) entry.timeout_ms = timeout;
  if (form.transport === "stdio") {
    entry.command = form.command.trim();
    if (form.args.trim().length > 0) {
      entry.args = form.args.match(/\S+/g) ?? [];
    }
    const env = parseKeyValueText(form.envText, "=");
    if (Object.keys(env).length > 0) entry.env = env;
    if (form.cwd.trim().length > 0) entry.cwd = form.cwd.trim();
  } else {
    entry.url = form.url.trim();
    const headers = parseKeyValueText(form.headersText, ":");
    if (Object.keys(headers).length > 0) entry.headers = headers;
  }
  return entry;
}

interface ParsedServerList {
  raw: RawServerEntry[];
  error?: string;
}

function parseServerList(servers: unknown): ParsedServerList {
  if (!Array.isArray(servers)) return { raw: [], error: "servers must be an array" };
  const seen = new Set<string>();
  const raw: RawServerEntry[] = [];
  for (const item of servers) {
    if (!item || typeof item !== "object") return { raw: [], error: "each server must be an object" };
    const entry = item as RawServerEntry;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) return { raw: [], error: "every server needs a name" };
    if (seen.has(name)) return { raw: [], error: `duplicate server name: ${name}` };
    seen.add(name);
    raw.push(entry);
  }
  return { raw };
}

export function McpConfig({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const mc = useMcpClient();
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [argsText, setArgsText] = useState("{}");
  const [callResult, setCallResult] = useState<{
    ok: boolean;
    message: string;
    content?: unknown;
  } | null>(null);
  const [busy, setBusy] = useState<{
    connect?: string;
    listTools?: string;
    call?: boolean;
    save?: boolean;
  }>({});

  const selectedView: McpServerView | undefined = useMemo(
    () => (selectedName ? mc.servers.find((s) => s.name === selectedName) : undefined),
    [mc.servers, selectedName],
  );

  // After a successful listServers, pick the first one if nothing
  // is selected. Don't fight user choice by overwriting later.
  useEffect(() => {
    if (selectedName) return;
    const first = mc.servers[0]?.name;
    if (first) setSelectedName(first);
  }, [mc.servers, selectedName]);

  // Re-fetch tools when selection changes & the server is connected.
  // `mc` is in the deps so the cache-guard (`toolsByServer[selectedName]`)
  // runs on every render; once the cache is hot this becomes a no-op.
  useEffect(() => {
    if (!selectedName) return;
    const v = mc.servers.find((s) => s.name === selectedName);
    if (!v || v.status !== "connected") return;
    if (mc.toolsByServer[selectedName]) return; // already cached
    void mc.listTools(selectedName);
  }, [selectedName, mc]);

  // Reset tool/args/result when switching servers.
  useEffect(() => {
    setSelectedTool(null);
    setArgsText("{}");
    setCallResult(null);
  }, [selectedName]);

  // ESC to close — handled by the useModalAnimation hook indirectly
  // (requestClose is stable across renders, so the effect won't rebind).
  // We re-derive from requestClose on each rebind to pick up the latest
  // hook closure.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const persistedServers = useMemo<RawServerEntry[]>(() => {
    return parseServerList(mc.config?.servers ?? []).raw;
  }, [mc.config]);

  const nameConflictFor = (formName: string, otherThan?: string): boolean => {
    const trimmed = formName.trim();
    if (!trimmed) return false;
    return persistedServers.some(
      (s) => s.name === trimmed && s.name !== otherThan,
    );
  };

  const upsertServer = useCallback(
    async (form: ServerFormState, originalName?: string): Promise<void> => {
      setBusy((b) => ({ ...b, save: true }));
      const next: RawServerEntry[] = persistedServers.map((s) => ({ ...s }));
      const entry = formToEntry(form);
      const idx = originalName
        ? next.findIndex((s) => s.name === originalName)
        : -1;
      if (idx >= 0) next[idx] = entry;
      else next.push(entry);
      const parsed = parseServerList(next);
      if (parsed.error) {
        toast.show({ kind: "error", message: parsed.error });
        setBusy((b) => ({ ...b, save: false }));
        return;
      }
      try {
        await mc.saveConfig({
          enabled: mc.config?.enabled ?? false,
          servers: parsed.raw,
        });
        toast.show({ kind: "success", message: t("Saved") });
        setEditingName(null);
        setAddingNew(false);
        setSelectedName(form.name.trim() || originalName || null);
      } catch (e) {
        toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy((b) => ({ ...b, save: false }));
      }
    },
    [mc, persistedServers, t, toast],
  );

  const deleteServer = useCallback(
    async (name: string) => {
      const next = persistedServers.filter((s) => s.name !== name);
      try {
        await mc.saveConfig({
          enabled: mc.config?.enabled ?? false,
          servers: next,
        });
        toast.show({ kind: "success", message: t("Deleted") });
        if (selectedName === name) setSelectedName(null);
      } catch (e) {
        toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [mc, persistedServers, selectedName, t, toast],
  );

  const toggleGlobalEnabled = useCallback(async () => {
    const next = Boolean(mc.config?.enabled);
    try {
      await mc.saveConfig({
        enabled: !next,
        servers: persistedServers,
      });
      toast.show({ kind: "success", message: t("Saved") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [mc, persistedServers, t, toast]);

  const handleConnect = useCallback(
    async (name: string) => {
      setBusy((b) => ({ ...b, connect: name }));
      try {
        const view = await mc.connect(name);
        if (view.status === "error") {
          toast.show({
            kind: "error",
            message: view.error ?? t("MCP connect failed"),
          });
        }
      } catch (e) {
        toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy((b) => ({ ...b, connect: undefined }));
      }
    },
    [mc, t, toast],
  );

  const handleDisconnect = useCallback(
    async (name: string) => {
      try {
        await mc.disconnect(name);
      } catch (e) {
        toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [mc, toast],
  );

  const handleListTools = useCallback(
    async (name: string, refresh = false) => {
      setBusy((b) => ({ ...b, listTools: name }));
      try {
        await mc.listTools(name, { refresh });
      } catch (e) {
        toast.show({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy((b) => ({ ...b, listTools: undefined }));
      }
    },
    [mc, toast],
  );

  const handleCall = useCallback(async () => {
    if (!selectedName || !selectedTool) return;
    let parsedArgs: unknown;
    const trimmed = argsText.trim();
    if (trimmed.length === 0) parsedArgs = {};
    else {
      try {
        parsedArgs = JSON.parse(trimmed);
      } catch (e) {
        toast.show({
          kind: "error",
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
    }
    setBusy((b) => ({ ...b, call: true }));
    try {
      const result = await mc.callTool(selectedName, selectedTool, parsedArgs);
      setCallResult({
        ok: !result.isError,
        message: result.isError ? "Tool returned an error" : "Success",
        content: result.content,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCallResult({ ok: false, message: msg });
    } finally {
      setBusy((b) => ({ ...b, call: false }));
    }
  }, [argsText, mc, selectedName, selectedTool, toast]);

  const renderLeftPane = () => (
    <div
      style={{
        width: 320,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border)",
        padding: 12,
        gap: 8,
        overflow: "auto",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--text)",
          marginBottom: 4,
        }}
      >
        <input
          type="checkbox"
          checked={Boolean(mc.config?.enabled)}
          onChange={toggleGlobalEnabled}
        />
        <span>{t("Enable MCP integration")}</span>
      </label>
      <button
        type="button"
        onClick={() => {
          setAddingNew((v) => !v);
          setEditingName(null);
        }}
        style={primaryButtonStyle}
      >
        {addingNew ? t("Cancel add") : t("+ Add server")}
      </button>

      {addingNew && (
        <ServerForm
          initial={blankForm()}
          isEdit={false}
          nameConflict={nameConflictFor("")}
          onSave={async (form) => {
            // Stash the candidate name against the current snapshot so
            // a Save right after a name conflict resolves correctly.
            if (nameConflictFor(form.name)) {
              toast.show({
                kind: "error",
                message: t("A server with this name already exists."),
              });
              return;
            }
            await upsertServer(form);
          }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        {t("Servers")} ({persistedServers.length})
      </div>
      {persistedServers.length === 0 && !addingNew && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            padding: 12,
            border: "1px dashed var(--border)",
            borderRadius: 6,
            textAlign: "center",
          }}
        >
          {t("No servers yet. Click \"+ Add server\" to add one.")}
        </div>
      )}

      {persistedServers.map((s) => {
        const name = s.name ?? "";
        const view = mc.servers.find((vs) => vs.name === name);
        const isSelected = selectedName === name;
        const isEditing = editingName === name;
        const formState = fromRawServer(s);
        return (
          <div
            key={name}
            style={{
              border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 6,
              padding: 8,
              background: isSelected ? "var(--bg-subtle)" : "var(--bg)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
            onClick={() => setSelectedName(name)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                {name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 6px",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  color: "var(--text-muted)",
                }}
              >
                {s.transport}
              </span>
              <StatusChip status={view?.status ?? "disconnected"} error={view?.error} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {view?.status === "connected"
                ? `${view.tools ?? 0} tool${(view.tools ?? 0) === 1 ? "" : "s"}`
                : s.enabled === false
                  ? t("MCP server disabled")
                  : t("not connected")}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {view?.status === "connected" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDisconnect(name);
                  }}
                  style={secondaryButtonStyle}
                >
                  {t("Disconnect")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleConnect(name);
                  }}
                  disabled={busy.connect === name || s.enabled === false}
                  style={{
                    ...primaryButtonStyle,
                    opacity: busy.connect === name || s.enabled === false ? 0.5 : 1,
                  }}
                >
                  {busy.connect === name ? t("Connecting…") : t("Connect")}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingName(isEditing ? null : name);
                  setAddingNew(false);
                }}
                style={secondaryButtonStyle}
              >
                {isEditing ? t("Cancel") : t("Edit")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteServer(name);
                }}
                style={{
                  ...secondaryButtonStyle,
                  color: "var(--accent)",
                }}
              >
                {t("Delete")}
              </button>
            </div>
            {isEditing && (
              <div onClick={(e) => e.stopPropagation()}>
                <ServerForm
                  initial={formState}
                  isEdit
                  nameConflict={nameConflictFor(formState.name, name)}
                  onSave={async (form) => {
                    if (nameConflictFor(form.name, name)) {
                      toast.show({
                        kind: "error",
                        message: t("A server with this name already exists."),
                      });
                      return;
                    }
                    await upsertServer(form, name);
                  }}
                  onCancel={() => setEditingName(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderRightPane = () => {
    if (!selectedName) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          {t("Select a server on the left, or add one to begin.")}
        </div>
      );
    }
    const v = selectedView;
    const tools = mc.toolsByServer[selectedName] ?? v?.toolNames?.map((name) => ({
      name,
      inputSchema: {},
    })) ?? [];
    const toolsLoading = mc.toolsLoadingByServer[selectedName];

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 12,
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
            {selectedName}
          </span>
          <StatusChip status={v?.status ?? "disconnected"} error={v?.error} />
          {v?.status === "connected" && (
            <button
              type="button"
              onClick={() => void handleListTools(selectedName, true)}
              disabled={busy.listTools === selectedName}
              style={secondaryButtonStyle}
            >
              {busy.listTools === selectedName ? t("Refreshing…") : t("Refresh tools")}
            </button>
          )}
        </div>
        {v?.error && (
          <div
            style={{
              padding: 8,
              borderRadius: 4,
              border: "1px solid var(--accent)",
              background: "var(--bg-subtle)",
              color: "var(--accent)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {v.error}
          </div>
        )}

        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("Tools")} ({tools.length})
        </div>

        {v?.status !== "connected" && (
          <div
            style={{
              padding: 12,
              border: "1px dashed var(--border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            {t("Connect the server to list its tools.")}
          </div>
        )}

        {v?.status === "connected" && toolsLoading && tools.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("Loading tools…")}
          </div>
        )}

        {tools.length > 0 && (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {tools.map((tool) => {
              const isSel = selectedTool === tool.name;
              return (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => setSelectedTool(tool.name)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: isSel ? "var(--bg-subtle)" : "var(--bg)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <div style={{ fontWeight: isSel ? 600 : 400 }}>{tool.name}</div>
                  {tool.description && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 2,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {tool.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selectedTool && (
          <>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("Arguments (JSON)")} — {selectedTool}
            </div>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              style={{
                width: "100%",
                minHeight: 100,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                background: "var(--bg)",
                color: "var(--text)",
                resize: "vertical",
              }}
            />
            <div>
              <button
                type="button"
                onClick={() => void handleCall()}
                disabled={busy.call}
                style={{
                  ...primaryButtonStyle,
                  opacity: busy.call ? 0.5 : 1,
                }}
              >
                {busy.call ? t("Calling…") : t("Call")}
              </button>
            </div>
            {callResult && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 6,
                  border: `1px solid ${callResult.ok ? "var(--border)" : "var(--accent)"}`,
                  background: "var(--bg-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: callResult.ok ? "var(--text)" : "var(--accent)",
                    marginBottom: 6,
                  }}
                >
                  {callResult.message}
                </div>
                {Array.isArray(callResult.content) && callResult.content.length > 0 ? (
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      maxHeight: 240,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      color: "var(--text)",
                    }}
                  >
                    {renderContentPreview(callResult.content)}
                  </pre>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          position: "relative",
          width: 960,
          height: "78vh",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>
            {t("MCP Servers")}
          </h2>
          {mc.loading && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("Loading…")}
            </span>
          )}
          <button
            type="button"
            onClick={requestClose}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text)",
              padding: "4px 10px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t("Close")}
          </button>
        </div>
        {mc.error && (
          <div
            style={{
              padding: 8,
              background: "var(--bg-subtle)",
              color: "var(--accent)",
              fontSize: 12,
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {mc.error}
          </div>
        )}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {renderLeftPane()}
          {renderRightPane()}
        </div>
        {/* Temporary "coming soon" overlay — sits above the panel body so
            the user can see the placeholder without losing the Close
            affordance. Closes via backdrop click or ESC. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in srgb, var(--bg) 78%, transparent)",
            backdropFilter: "blur(2px)",
            zIndex: 10,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              maxWidth: 460,
              padding: "28px 32px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              {t("Coming soon")}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.35,
              }}
            >
              {t("MCP Servers support is coming soon")}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.55,
              }}
            >
              {t(
                "We're polishing the integration. The full MCP server management UI will land in a future release. Press Esc or click outside to close this preview.",
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to format a CallTool `content` array for the result panel.
// Text entries are kept verbatim; image / audio / resource entries are
// summarised so the panel doesn't dump a 1 MB base64 string.
function renderContentPreview(content: unknown[]): string {
  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      parts.push(obj.text);
    } else if (obj.type === "image" && typeof obj.data === "string") {
      parts.push(`[image ${obj.mimeType ?? "image/png"}, ${obj.data.length} chars base64]`);
    } else if (obj.type === "audio" && typeof obj.data === "string") {
      parts.push(`[audio ${obj.mimeType ?? "audio/mpeg"}, ${obj.data.length} chars base64]`);
    } else if (obj.type === "resource") {
      parts.push(`[resource: ${JSON.stringify(obj.resource, null, 2).slice(0, 1024)}]`);
    }
  }
  return parts.join("\n\n");
}

function StatusChip({
  status,
  error,
}: {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
}) {
  const color =
    status === "connected"
      ? "var(--accent)"
      : status === "error"
        ? "var(--accent)"
        : "var(--text-muted)";
  return (
    <span
      title={error}
      style={{
        fontSize: 11,
        padding: "1px 6px",
        border: `1px solid ${color}`,
        borderRadius: 999,
        color,
      }}
    >
      ● {status}
    </span>
  );
}
