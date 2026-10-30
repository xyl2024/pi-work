import type { ToolInfo } from "../shared/types";

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

export interface ToolWithActive extends ToolInfo {
  active: boolean;
}

export async function listToolsForCwd(cwd: string): Promise<ToolInfo[]> {
  const res = await fetch("/api/agent/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { available: ToolInfo[] };
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data?.available ?? [];
}
