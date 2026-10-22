export interface ModelConnectionTestResult {
  ok: boolean;
  startedAt: string;
  durationMs: number;
  firstEventMs?: number;
  error?: string;
  diagnostics: string;
  truncated: boolean;
}
