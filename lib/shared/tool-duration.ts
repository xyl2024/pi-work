export function formatToolAnnotation({ timeout, durationMs }: { timeout?: string | null; durationMs?: number | null }): string | null {
  const parts: string[] = [];
  if (typeof timeout === "string" && timeout !== "") parts.push(`timeout=${timeout}s`);
  const duration = formatToolDuration(durationMs);
  if (duration) parts.push(`duration=${duration}`);
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
