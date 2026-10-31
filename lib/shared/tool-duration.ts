export type ToolAnnotationTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const interpolateLabel: ToolAnnotationTranslator = (key, values) =>
  values
    ? key.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in values ? String(values[name]) : match,
      )
    : key;

function normalizeTimeout(timeout: unknown): string | null {
  if (typeof timeout === "number") {
    return Number.isFinite(timeout) ? String(timeout) : null;
  }
  if (typeof timeout === "string" && timeout.trim() !== "") return timeout;
  return null;
}

export function formatToolAnnotation(
  { timeout, durationMs }: { timeout?: unknown; durationMs?: number | null },
  translate: ToolAnnotationTranslator = interpolateLabel,
): string | null {
  const parts: string[] = [];
  const timeoutValue = normalizeTimeout(timeout);
  if (timeoutValue !== null) {
    parts.push(translate("timeout={timeout}s", { timeout: timeoutValue }));
  }
  const duration = formatToolDuration(durationMs);
  if (duration) parts.push(translate("duration={duration}", { duration }));
  if (parts.length === 0) return null;
  return `(${parts.join(", ")})`;
}

export function formatToolDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}
