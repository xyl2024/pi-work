export type SessionExportFormat = "html" | "jsonl";

export function parseSessionExportFormat(value: string | null): SessionExportFormat {
  return value === "jsonl" ? "jsonl" : "html";
}

export function sessionExportExtension(format: SessionExportFormat): string {
  return format === "jsonl" ? "jsonl" : "html";
}
