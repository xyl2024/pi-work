/**
 * Pure rules shared by the model-call metrics recorder and the query mapper.
 *
 * Kept free of Node, SQLite and SDK imports so the no-metric / zero-metric
 * rules can be read (and tested) in one place. The persisted facts are the
 * raw intervals and the provider-reported output usage; TPS is always derived
 * here at read time so storage and API can never disagree about the formula.
 */

import type { CallStatus } from "./token-audit-types";

export interface CallMetricFacts {
  status: CallStatus;
  /** Provider-reported output tokens; `null` when usage was not reported. */
  outputTokens: number | null;
  /** First effective output → last effective output. `null` when never observed. */
  generationDurationMs: number | null;
  /** Logical call start → terminal event. `null` when unknown. */
  durationMs: number | null;
}

export interface CallThroughput {
  generationTps: number | null;
  endToEndTps: number | null;
}

export function isValidTokenCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * A throughput denominator is usable only when it is a positive, finite
 * number. Zero-length windows mean "no measurable generation window" (e.g. a
 * single output chunk), never "infinite speed".
 */
export function isValidDurationMs(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * TPS for one logical model call.
 *
 * - Failed/cancelled calls never expose throughput, even when partial usage
 *   and a positive window were observed.
 * - Missing usage (`null`) is not zero usage; it yields `null`.
 * - A genuinely reported zero output on a completed call yields `0` for
 *   end-to-end TPS (when the denominator is valid) and `null` for generation
 *   TPS, which also requires a positive generation window.
 */
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
