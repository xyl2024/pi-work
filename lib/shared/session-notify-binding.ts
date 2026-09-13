// ============================================================================
// Session notify binding rules (pure)
//
// A session may be bound to a messaging channel so its assistant replies get
// delivered there. The binding lives in a per-session sidecar on the server
// (`~/.pi-work/session-notify/<session-id>.json`), and the chat window has two
// writers:
//
//   - the new-session flow: the channel picked on the welcome screen is PUT
//     once the session id exists (`currentSessionId` flips null → real id);
//   - the MoreMenu: editing the binding of an existing session.
//
// Reading it back is the branchy part. Opening a session fires a GET, but a
// brand-new session may still be racing the PUT that created its binding, so
// the disk answer must be ignored for the session this window just wrote.
// These functions hold those rules; the hook holds the fetches.
// ============================================================================

/** Parse the `config` field of a `GET /api/sessions/[id]/notify` response. */
export function parseSessionNotifyChannelId(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const channelId = (config as { channelId?: unknown }).channelId;
  if (typeof channelId !== "string") return null;
  const trimmed = channelId.trim();
  return trimmed ? trimmed : null;
}

export interface SessionNotifySaveInput {
  /** Session id after creation (null while the new-session page is still open). */
  currentSessionId: string | null | undefined;
  /** Channel picked on the new-session page (null = "no notification"). */
  pickedChannelId: string | null;
  /** Session whose binding was already persisted by this window. */
  savedSessionId: string | null;
}

export type SessionNotifySaveDecision =
  /** Write this binding now, to this session. */
  | { kind: "persist"; sessionId: string; channelId: string }
  | { kind: "skip" };

/**
 * Should the new-session binding be persisted now? A null pick is never saved
 * (there is nothing to write), and each session is saved at most once. The
 * validated session id and channel come back with the decision so the caller
 * never has to re-check them.
 */
export function decideSessionNotifySave(input: SessionNotifySaveInput): SessionNotifySaveDecision {
  if (!input.currentSessionId) return { kind: "skip" };
  if (input.pickedChannelId == null) return { kind: "skip" };
  if (input.savedSessionId === input.currentSessionId) return { kind: "skip" };
  return { kind: "persist", sessionId: input.currentSessionId, channelId: input.pickedChannelId };
}

export interface SessionNotifyLocallySavedInput {
  /** The session whose binding is being loaded from disk. */
  sessionId: string;
  /** Session whose binding this window already wrote (new-session flow). */
  savedSessionId: string | null;
}

/**
 * Must the disk read be ignored? Yes for the session this window just wrote —
 * the GET was issued before (or alongside) the PUT, so its answer may still be
 * the pre-save state. Every other session trusts disk.
 */
export function isSessionNotifyBindingLocallySaved(
  input: SessionNotifyLocallySavedInput,
): boolean {
  return input.savedSessionId !== null && input.savedSessionId === input.sessionId;
}
