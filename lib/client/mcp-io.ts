"use client";

import type { McpPanelChange, McpPanelData } from "@/lib/shared/mcp-panel";

export async function fetchMcpPanelData(cwd: string): Promise<McpPanelData> {
  const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
  const payload = (await res.json()) as McpPanelData & { error?: string };
  if (!res.ok || payload.error) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload;
}

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
