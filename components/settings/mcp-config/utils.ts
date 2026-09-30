/**
 * Pure display/parse helpers for the MCP panel.
 *
 * Everything here works on the plain entry objects the panel passes around:
 * the form's text fields (args / env / headers are textareas), the entry card's
 * one-line summary, and the transport an entry currently uses.
 */

import type { McpExposure } from "@/lib/shared/mcp-panel";

export type McpTransport = "stdio" | "http" | "unknown";

/** Which transport an entry's config describes. `url` wins over `command`, as in pi. */
export function transportOf(config: Record<string, unknown> | null): McpTransport {
  if (!config) return "unknown";
  if (typeof config.url === "string") return "http";
  if (typeof config.command === "string") return "stdio";
  return "unknown";
}

/** The one line an entry card shows: the URL, or the command with its arguments. */
export function summarizeEntry(config: Record<string, unknown> | null): string {
  if (!config) return "";
  if (typeof config.url === "string") return config.url;
  if (typeof config.command !== "string") return "";
  const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
  return [config.command, ...args].join(" ");
}

export function exposureOf(config: Record<string, unknown> | null): McpExposure {
  const value = config?.exposure;
  return typeof value === "string" && value !== "" ? (value as McpExposure) : "codemode";
}

export function isEnabled(config: Record<string, unknown> | null): boolean {
  return config?.enabled !== false;
}

/** Textarea ⇄ `args`: one argument per line, blank lines dropped. */
export function splitLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

export function joinLines(items: string[]): string {
  return items.join("\n");
}

/**
 * Textarea ⇄ `env` / `headers`: one `NAME=value` per line. The value keeps
 * everything after the first `=` untouched, so `${TOKEN}` and `Bearer x=y` both
 * survive a round trip — pi resolves the references when the server connects.
 */
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

/** pi's per-request timeout: a positive number of seconds, absent meaning 60. */
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
