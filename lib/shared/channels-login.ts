export type LoginPhase =
  | "waiting"
  | "scanned"
  | "verifying"
  | "verify_blocked"
  | "redirected"
  | "confirmed"
  | "already_bound"
  | "expired"
  | "error";

export const LOGIN_PHASES: readonly LoginPhase[] = [
  "waiting",
  "scanned",
  "verifying",
  "verify_blocked",
  "redirected",
  "confirmed",
  "already_bound",
  "expired",
  "error",
];

const PHASE_LABEL_KEYS: Record<LoginPhase, string> = {
  waiting: "channels.waitingScan",
  scanned: "channels.scanned",
  verifying: "channels.verifying",
  verify_blocked: "channels.verifyBlocked",
  redirected: "channels.redirected",
  confirmed: "channels.confirmed",
  already_bound: "channels.alreadyBound",
  expired: "channels.qrExpired",
  error: "channels.error",
};

export function loginPhaseLabelKey(phase: LoginPhase): string {
  return PHASE_LABEL_KEYS[phase];
}

export function isLoginInProgress(phase: LoginPhase | null): boolean {
  if (phase === null) return false;
  return (
    phase === "waiting" ||
    phase === "scanned" ||
    phase === "verifying" ||
    phase === "verify_blocked" ||
    phase === "redirected"
  );
}
