import type { OAuthLoginState } from "@/lib/shared/models-config";

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
  | { type: "stream_error" }
  | { type: "reset" };

export const OAUTH_LOGIN_IDLE: OAuthLoginState = { phase: "idle" };

export interface OAuthLoginTransition {
  state: OAuthLoginState;
  closeStream: boolean;
  openUrl: string | null;
  succeeded: boolean;
}

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

export function oauthLoginToken(state: OAuthLoginState): string | null {
  return state.phase === "auth" || state.phase === "prompt" || state.phase === "select" ? state.token : null;
}

export function isOAuthLoginWorking(state: OAuthLoginState): boolean {
  return state.phase !== "idle" && state.phase !== "success" && state.phase !== "error";
}

export function anyOAuthLoginInProgress(states: readonly OAuthLoginState[]): boolean {
  return states.some(isOAuthLoginWorking);
}
