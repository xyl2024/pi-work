/**
 * The OAuth login state machine: one provider's authorization flow, driven by
 * the auth server's SSE messages plus a few transport facts.
 *
 * Pure — the reducer takes the current phase and one event and returns the next
 * phase plus the one-shot effects the transport layer must run (close the
 * stream, open the auth URL, fire the success refresh). The `EventSource`
 * subscription itself lives in `lib/client/oauth-login-store.ts`; this file is
 * the rule that store runs, so the phase transitions (success / failure /
 * need-input / select / reset) can be driven from `tests/unit` without a
 * browser or a live auth server.
 *
 * It lives in `lib/client` rather than `lib/shared` because some of its inputs
 * are transport facts (`start` / `stream_error` / `reset`), not pure domain
 * facts — ADR-0003's 修订 sends that shape to the client layer while staying a
 * pure, directly testable module.
 */

import type { OAuthLoginState } from "@/lib/shared/models-config";

/**
 * One protocol message from `GET /api/auth/login/[provider]` (the `data:`
 * payload, already JSON-parsed), or a transport fact the store injects
 * (`start` / `stream_error` / `reset`).
 */
export type OAuthLoginEvent =
  | { type: "start" }
  | { type: "auth"; url: string; instructions: string | null; token: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds: number | null;
      expiresInSeconds: number | null;
    }
  | { type: "prompt_request"; message: string; placeholder: string | null; token: string }
  | { type: "select_request"; message: string; options: { id: string; label: string }[]; token: string }
  | { type: "progress"; message: string }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  /** `EventSource.onerror` — the connection dropped before a terminal message. */
  | { type: "stream_error" }
  /** The user cancelled, or the surface explicitly cleared the session. */
  | { type: "reset" };

/** The phase of a provider that has never started logging in. */
export const OAUTH_LOGIN_IDLE: OAuthLoginState = { phase: "idle" };

export interface OAuthLoginTransition {
  /** The next phase. */
  state: OAuthLoginState;
  /** The SSE stream must be closed after applying this transition. */
  closeStream: boolean;
  /** The transport must open this URL in a new window. */
  openUrl: string | null;
  /** The provider list changed server-side (login succeeded). */
  succeeded: boolean;
}

/**
 * Map a parsed SSE payload to an event. Returns null for anything the flow
 * does not understand, which the caller ignores (the stream stays open).
 *
 * Known message types are trusted as-is — field presence is the server
 * contract, the same way the component relied on it before.
 */
export function parseOAuthLoginEvent(raw: unknown): OAuthLoginEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  switch (data.type) {
    case "auth":
      return {
        type: "auth",
        url: data.url as string,
        instructions: (data.instructions as string | null) ?? null,
        token: data.token as string,
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: data.userCode as string,
        verificationUri: data.verificationUri as string,
        intervalSeconds: (data.intervalSeconds as number | null) ?? null,
        expiresInSeconds: (data.expiresInSeconds as number | null) ?? null,
      };
    case "prompt_request":
      return {
        type: "prompt_request",
        message: data.message as string,
        placeholder: (data.placeholder as string | null) ?? null,
        token: data.token as string,
      };
    case "select_request":
      return {
        type: "select_request",
        message: data.message as string,
        options: (data.options as { id: string; label: string }[] | undefined) ?? [],
        token: data.token as string,
      };
    case "progress":
      return { type: "progress", message: data.message as string };
    case "success":
      return { type: "success" };
    case "error":
      return { type: "error", message: data.message as string };
    case "cancelled":
      return { type: "cancelled" };
    default:
      return null;
  }
}

/**
 * Apply one event. A dropped stream after success must not turn the phase back
 * into an error — the server closes the stream on success and `EventSource`
 * reports that close as an error.
 */
export function reduceOAuthLogin(state: OAuthLoginState, event: OAuthLoginEvent): OAuthLoginTransition {
  const base = { closeStream: false, openUrl: null, succeeded: false } as const;
  switch (event.type) {
    case "start":
      return { ...base, state: { phase: "connecting" }, closeStream: true };
    case "auth":
      return {
        ...base,
        state: { phase: "auth", url: event.url, instructions: event.instructions, token: event.token },
        openUrl: event.url,
      };
    case "device_code":
      return {
        ...base,
        state: {
          phase: "device_code",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        },
      };
    case "prompt_request":
      return {
        ...base,
        state: { phase: "prompt", message: event.message, placeholder: event.placeholder, token: event.token },
      };
    case "select_request":
      return {
        ...base,
        state: { phase: "select", message: event.message, options: event.options, token: event.token },
      };
    case "progress":
      return { ...base, state: { phase: "progress", message: event.message } };
    case "success":
      return { ...base, state: { phase: "success" }, closeStream: true, succeeded: true };
    case "error":
      return { ...base, state: { phase: "error", message: event.message }, closeStream: true };
    case "cancelled":
    case "reset":
      return { ...base, state: { phase: "idle" }, closeStream: true };
    case "stream_error":
      return state.phase === "success"
        ? { ...base, state, closeStream: true }
        : { ...base, state: { phase: "error", message: "Connection lost" }, closeStream: true };
  }
}

/** The pending manual-input token, when the phase is waiting for the user. */
export function oauthLoginToken(state: OAuthLoginState): string | null {
  return state.phase === "auth" || state.phase === "prompt" || state.phase === "select" ? state.token : null;
}

/** Whether the phase means "a login is running" (the cancel button shows). */
export function isOAuthLoginWorking(state: OAuthLoginState): boolean {
  return state.phase !== "idle" && state.phase !== "success" && state.phase !== "error";
}

/**
 * Whether any provider still has a login in flight. The panel-tab close guard
 * aggregates every provider's session through this, so "is an authorization
 * running?" is one rule instead of a `some(isOAuthLoginWorking)` written per
 * call site.
 */
export function anyOAuthLoginInProgress(states: readonly OAuthLoginState[]): boolean {
  return states.some(isOAuthLoginWorking);
}
