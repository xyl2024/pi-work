"use client";

/**
 * Client-side request wrappers for the MCP panel.
 *
 * Thin fetch helpers only — `lib/client/mcp-store.ts` owns the per-cwd bucket
 * map, the "clean re-open re-reads disk" policy and the module-level lifetime.
 * Mirrors `lib/client/channels-io.ts` / `lib/client/skills-io.ts`.
 */

import type { McpPanelChange, McpPanelData } from "@/lib/shared/mcp-panel";

/** Read both `mcp.json` files for one working directory. */
export async function fetchMcpPanelData(cwd: string): Promise<McpPanelData> {
  const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
  const payload = (await res.json()) as McpPanelData & { error?: string };
  if (!res.ok || payload.error) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload;
}

/** Apply this save's whole batch in one request (one read-modify-write per file). */
export async function putMcpPanelChanges(cwd: string, changes: McpPanelChange[]): Promise<void> {
  const res = await fetch("/api/mcp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, changes }),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(payload.error ?? `HTTP ${res.status}`);
}
