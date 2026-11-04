import type { LoginPhase } from "./channels-login";

export const CHANNELS_GUARDED_PHASES: readonly LoginPhase[] = [
  "waiting",
  "scanned",
  "verifying",
];

export function isChannelsLeaveGuarded(phase: LoginPhase | null): boolean {
  return phase !== null && CHANNELS_GUARDED_PHASES.includes(phase);
}
