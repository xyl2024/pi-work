/**
 * The WeChat scan-login phase machine, shared by the channels panel's UI, its
 * module store and its close guard.
 *
 * The nine phases are what the server's login session reports. Two questions
 * are asked about a phase, and they are deliberately different:
 *
 *   • `isLoginInProgress` — should the 2s status poll keep running? True for
 *     every phase where the session is still useful to the user (including
 *     `verify_blocked`, where a wrong pairing code was entered, and `redirected`,
 *     where the server is switching IDC nodes).
 *   • the close guard (`lib/shared/channels-close.ts`) only warns for
 *     `waiting / scanned / verifying` — the phases where the user has an
 *     unfinished action on screen.
 *
 * Pure — no React / DOM / server imports — so both questions are driven from
 * `tests/unit`.
 */

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

/** Every phase, in the order the UI lists them. */
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

/** The i18n key for a phase's status line. */
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

/**
 * Whether a login session is still in flight: the 2s status poll runs only
 * while this is true. `confirmed / already_bound / expired / error` are
 * terminal; `verify_blocked` and `redirected` are not — the session is still
 * the user's to finish (refresh the QR, or wait out the node switch).
 */
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

/** A terminal phase can no longer change by polling. */
export function isLoginTerminal(phase: LoginPhase | null): boolean {
  return phase !== null && !isLoginInProgress(phase);
}
