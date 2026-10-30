import type { CallSource, CallStatus } from "./token-audit-types";

const CALL_SOURCES = new Set<CallSource>([
  "user",
  "scheduled",
  "subagent",
  "direct",
  "btw",
  "unknown",
]);

export function isCallSource(value: string | null | undefined): value is CallSource {
  return typeof value === "string" && CALL_SOURCES.has(value as CallSource);
}

export interface CallMetricFacts {
  status: CallStatus;
  outputTokens: number | null;
  generationDurationMs: number | null;
  durationMs: number | null;
}

export interface CallThroughput {
  generationTps: number | null;
  endToEndTps: number | null;
}

export function isValidTokenCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isValidDurationMs(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function deriveCallThroughput(facts: CallMetricFacts): CallThroughput {
  const completed = facts.status === "completed";
  const tokens = facts.outputTokens;
  const hasUsage = isValidTokenCount(tokens);
  const generationTps =
    completed && hasUsage && isValidDurationMs(facts.generationDurationMs)
      ? (tokens * 1000) / facts.generationDurationMs
      : null;
  const endToEndTps =
    completed && hasUsage && isValidDurationMs(facts.durationMs)
      ? (tokens * 1000) / facts.durationMs
      : null;
  return { generationTps, endToEndTps };
}
