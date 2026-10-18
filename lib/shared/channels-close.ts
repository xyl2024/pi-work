/**
 * Close guard for the channels panel view.
 *
 * The panel tab's × lives in the shell's tab strip, but only the panel knows
 * whether closing it would throw something away. This module is that one
 * question, asked the way the skills / scheduler guards ask it: pass the
 * conditions, get back the confirmation to show, or null when the tab may close
 * silently.
 *
 * The one lossy condition is a **live scan login** — not a draft. The channels
 * panel holds no draft at all (ADR-0009 / ADR-0017): the new-channel input is a
 * create action, and rename / enable / workspace switch all write through
 * immediately. What it does hold is a login session in flight, with a QR code on
 * screen and a pairing code half-typed.
 *
 * Which phases guard:
 *   • `waiting` / `scanned` / `verifying` — the user has an unfinished action on
 *     screen and the session can still succeed. Guarded.
 *   • `redirected` — deliberately **not** guarded. The server is switching IDC
 *     nodes on its own; the client cannot act on this phase, and the issue's
 *     guard rule stops at `verifying`. Reopening the panel resumes the same
 *     session from the store.
 *   • `verify_blocked` — not guarded. Too many wrong pairing codes means the
 *     session can no longer confirm without a fresh QR, so there is nothing left
 *     to lose.
 *   • `confirmed` / `already_bound` / `expired` / `error` — terminal, nothing to
 *     lose. Not guarded.
 *
 * Pure — no React / DOM / server imports — so the decision is driven from
 * `tests/unit`. The shell maps the returned i18n keys through `t()`.
 */

import type { LoginPhase } from "./channels-login";

/** What the close decision reads. */
export interface ChannelsCloseConditions {
  /** The live scan-login phase, or null when no session is running. */
  phase: LoginPhase | null;
}

/** The confirmation to show before closing the channels tab. */
export interface ChannelsCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  /** Button label for "yes, close". Cancel always keeps the tab. */
  confirmLabelKey: string;
}

/** Shown when closing would abandon a scan the user has not finished. */
export const CHANNELS_LOGIN_CLOSE_CONFIRM: ChannelsCloseConfirm = {
  titleKey: "Close while scanning?",
  descriptionKey: "The scan will be interrupted and you'll need a new QR code.",
  confirmLabelKey: "Close",
};

/** The phases where an unfinished scan would be lost. */
export const CHANNELS_GUARDED_PHASES: readonly LoginPhase[] = [
  "waiting",
  "scanned",
  "verifying",
];

/**
 * The confirmation to show before closing the channels tab, or null when it may
 * close silently. Only an unfinished scan makes the close lossy.
 */
export function selectChannelsCloseConfirm(
  conditions: ChannelsCloseConditions,
): ChannelsCloseConfirm | null {
  if (conditions.phase === null) return null;
  return CHANNELS_GUARDED_PHASES.includes(conditions.phase)
    ? CHANNELS_LOGIN_CLOSE_CONFIRM
    : null;
}
