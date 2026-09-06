/**
 * Shared types for the `celebrate` custom agent tool.
 *
 * The server-side tool (lib/server/celebrate-tool.ts) validates the call and
 * returns these details on its result. The frontend consumes them in
 * `hooks/useAgentSession/events.ts` (`tool_execution_end`) and drives the
 * `components/effects/CelebrationOverlay.tsx` animation through
 * `lib/client/celebrate-store.ts`. Client-safe: no Node / server imports.
 */

export const CELEBRATE_TOOL_NAME = "pi_work_celebrate";

export type CelebrationStyle = "auto" | "confetti" | "cannon" | "grand";

/** Default animation length, and the hard cap accepted from the model. */
export const CELEBRATE_DEFAULT_DURATION_MS = 5000;
export const CELEBRATE_MAX_DURATION_MS = 15000;

/** Details attached to the tool result (visible to the frontend via SSE). */
export interface CelebrateDetails {
  style: CelebrationStyle;
  /** Resolved concrete effect when the model asked for "auto". */
  resolvedStyle: "confetti" | "cannon" | "grand";
  durationMs: number;
}
