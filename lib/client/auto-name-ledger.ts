"use client";

/**
 * Module-level ledger of sessions that already got the silent auto-name
 * trigger. Keyed by session id, shared across every session tab.
 *
 * This is deliberately *not* an instance ref: one chat window is mounted per
 * session tab, so an instance ledger resets when the tab is closed and
 * reopened — and the same session gets named a second time. A session is named
 * once, so the ledger is keyed by session. (The only other per-tab state can
 * stay per-tab; this one was demonstrably wrong.)
 *
 * Runtime-only, never persisted: a page reload may re-trigger the silent
 * auto-name for a still-unnamed session, exactly as before.
 */

const autoNamedSessionIds = new Set<string>();

/**
 * Claim the silent auto-name trigger for a session. Returns `false` when the
 * session was already claimed, which is how a reopened tab (a fresh instance)
 * and concurrent triggers collapse into one request.
 */
export function claimAutoNamedSession(sessionId: string): boolean {
  if (autoNamedSessionIds.has(sessionId)) return false;
  autoNamedSessionIds.add(sessionId);
  return true;
}
