import { resolveMcpExposure, type McpExposure } from "@/lib/shared/mcp-panel";

export type McpTransport = "stdio" | "http" | "unknown";

export function transportOf(config: Record<string, unknown> | null): McpTransport {
  if (!config) return "unknown";
  if (typeof config.url === "string") return "http";
  if (typeof config.command === "string") return "stdio";
  return "unknown";
}

export function summarizeEntry(config: Record<string, unknown> | null): string {
  if (!config) return "";
  if (typeof config.url === "string") return config.url;
  if (typeof config.command !== "string") return "";
  const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
  return [config.command, ...args].join(" ");
}

export function exposureOf(config: Record<string, unknown> | null): McpExposure {
  return resolveMcpExposure(config?.exposure);
}

export function isEnabled(config: Record<string, unknown> | null): boolean {
  return config?.enabled !== false;
}

export function splitLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

export function joinLines(items: string[]): string {
  return items.join("\n");
}

export function parseKeyValueLines(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;
    record[key] = line.slice(separator + 1);
  }
  return record;
}

export function formatKeyValueLines(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function parseTimeout(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function timeoutTextOf(config: Record<string, unknown> | null): string {
  const value = config?.timeout;
  return typeof value === "number" ? String(value) : "";
}
