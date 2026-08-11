"use client";

/**
 * Client-side façade over the `/api/mcp/*` routes.
 *
 * No React Query — the McpConfig modal is itself short-lived and the
 * operations are user-triggered, so a `fetch` wrapper with manually
 * refreshed state is enough.
 *
 * Errors are returned, not thrown, so call sites can decide whether
 * to show them as a status-chip indicator or as a toast. (The modal
 * uses status chips; toasts would be the right call from elsewhere.)
 */

import { useCallback, useEffect, useState } from "react";

export type McpTransport = "stdio" | "http";

export interface McpServerView {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  tools?: number;
  toolNames?: string[];
  connectedAt?: number;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string }
  | { type: "resource"; resource: unknown };

export interface McpCallResult {
  isError: boolean;
  content: McpContent[];
}

export interface McpConfigPayload {
  enabled: boolean;
  servers: unknown[];
  path?: string;
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const msg = typeof data.error === "string" ? data.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function useMcpClient() {
  const [config, setConfig] = useState<McpConfigPayload | null>(null);
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-server tool cache, keyed by server name; tracks which server
  // has been actively fetched during this modal session.
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolInfo[]>>({});
  const [toolsLoadingByServer, setToolsLoadingByServer] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await jsonFetch<{ enabled: boolean; servers: McpServerView[] }>("/api/mcp");
      setServers(list.servers ?? []);
      // Also pull the file config for the Edit / Add form (carries the
      // raw server objects, not the live views).
      try {
        const cfg = await jsonFetch<McpConfigPayload>("/api/mcp/config");
        setConfig(cfg);
      } catch {
        // /api/mcp always returns a snapshot; /api/mcp/config may fail
        // on a corrupt file. Non-fatal — surface through `error` only.
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveConfig = useCallback(async (next: McpConfigPayload): Promise<void> => {
    // Re-shape to drop the `path` field that GET adds for display.
    const body = { enabled: next.enabled, servers: next.servers };
    await jsonFetch<unknown>("/api/mcp/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  }, [refresh]);

  const connect = useCallback(async (name: string): Promise<McpServerView> => {
    const view = await jsonFetch<McpServerView>(
      `/api/mcp/${encodeURIComponent(name)}`,
      { method: "POST" },
    );
    await refresh();
    return view;
  }, [refresh]);

  const disconnect = useCallback(async (name: string): Promise<void> => {
    await jsonFetch<unknown>(`/api/mcp/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    await refresh();
  }, [refresh]);

  const listTools = useCallback(
    async (name: string, opts?: { refresh?: boolean }): Promise<McpToolInfo[]> => {
      setToolsLoadingByServer((m) => ({ ...m, [name]: true }));
      try {
        const q = opts?.refresh ? "?refresh=1" : "";
        const data = await jsonFetch<{ tools: McpToolInfo[] }>(
          `/api/mcp/${encodeURIComponent(name)}/tools${q}`,
        );
        setToolsByServer((m) => ({ ...m, [name]: data.tools ?? [] }));
        return data.tools ?? [];
      } finally {
        setToolsLoadingByServer((m) => ({ ...m, [name]: false }));
      }
    },
    [],
  );

  const callTool = useCallback(
    async (name: string, tool: string, args: unknown): Promise<McpCallResult> => {
      return await jsonFetch<McpCallResult>(
        `/api/mcp/${encodeURIComponent(name)}/call`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tool, arguments: args }),
        },
      );
    },
    [],
  );

  return {
    config,
    servers,
    loading,
    error,
    toolsByServer,
    toolsLoadingByServer,
    refresh,
    saveConfig,
    connect,
    disconnect,
    listTools,
    callTool,
  };
}

export type UseMcpClientReturn = ReturnType<typeof useMcpClient>;
