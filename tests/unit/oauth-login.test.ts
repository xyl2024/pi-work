import { describe, expect, it } from "vitest";
import {
  OAUTH_LOGIN_IDLE,
  anyOAuthLoginInProgress,
  isOAuthLoginWorking,
  oauthLoginToken,
  parseOAuthLoginEvent,
  reduceOAuthLogin,
} from "@/lib/client/oauth-login";
import type { OAuthLoginState } from "@/lib/shared/models-config";

describe("parseOAuthLoginEvent", () => {
  it("maps each protocol message to its event", () => {
    expect(parseOAuthLoginEvent({ type: "auth", url: "https://x", instructions: null, token: "t" })).toEqual({
      type: "auth",
      url: "https://x",
      instructions: null,
      token: "t",
    });
    expect(parseOAuthLoginEvent({ type: "device_code", userCode: "ABCD", verificationUri: "https://v" })).toEqual({
      type: "device_code",
      userCode: "ABCD",
      verificationUri: "https://v",
      intervalSeconds: null,
      expiresInSeconds: null,
    });
    expect(parseOAuthLoginEvent({ type: "prompt_request", message: "paste it", token: "t" })).toEqual({
      type: "prompt_request",
      message: "paste it",
      placeholder: null,
      token: "t",
    });
    expect(parseOAuthLoginEvent({ type: "select_request", message: "pick", token: "t", options: [{ id: "a", label: "A" }] })).toEqual({
      type: "select_request",
      message: "pick",
      token: "t",
      options: [{ id: "a", label: "A" }],
    });
    expect(parseOAuthLoginEvent({ type: "progress", message: "wait" })).toEqual({ type: "progress", message: "wait" });
    expect(parseOAuthLoginEvent({ type: "success" })).toEqual({ type: "success" });
    expect(parseOAuthLoginEvent({ type: "error", message: "nope" })).toEqual({ type: "error", message: "nope" });
    expect(parseOAuthLoginEvent({ type: "cancelled" })).toEqual({ type: "cancelled" });
  });

  it("ignores an unknown type and a non-object payload", () => {
    expect(parseOAuthLoginEvent({ type: "pong" })).toBeNull();
    expect(parseOAuthLoginEvent(null)).toBeNull();
    expect(parseOAuthLoginEvent("success")).toBeNull();
  });

  it("defaults a select_request with no options to an empty list", () => {
    expect(parseOAuthLoginEvent({ type: "select_request", message: "pick", token: "t" })).toEqual({
      type: "select_request",
      message: "pick",
      token: "t",
      options: [],
    });
  });
});

describe("reduceOAuthLogin: need input", () => {
  it("start moves to connecting and closes any prior stream", () => {
    const t = reduceOAuthLogin(OAUTH_LOGIN_IDLE, { type: "start" });
    expect(t.state).toEqual({ phase: "connecting" });
    expect(t.closeStream).toBe(true);
    expect(t.openUrl).toBeNull();
    expect(t.succeeded).toBe(false);
  });

  it("auth carries the URL, opens it, and keeps the token for the paste step", () => {
    const t = reduceOAuthLogin({ phase: "connecting" }, { type: "auth", url: "https://auth", instructions: "do it", token: "tok" });
    expect(t.state).toEqual({ phase: "auth", url: "https://auth", instructions: "do it", token: "tok" });
    expect(t.openUrl).toBe("https://auth");
    expect(t.closeStream).toBe(false);
  });

  it("prompt_request keeps the token and the placeholder", () => {
    const t = reduceOAuthLogin({ phase: "connecting" }, { type: "prompt_request", message: "code?", placeholder: "123", token: "tok" });
    expect(t.state).toEqual({ phase: "prompt", message: "code?", placeholder: "123", token: "tok" });
    expect(t.closeStream).toBe(false);
  });

  it("device_code keeps the code, verification URI and expiry", () => {
    const t = reduceOAuthLogin({ phase: "connecting" }, { type: "device_code", userCode: "ABCD", verificationUri: "https://v", intervalSeconds: 5, expiresInSeconds: 300 });
    expect(t.state).toEqual({ phase: "device_code", userCode: "ABCD", verificationUri: "https://v", intervalSeconds: 5, expiresInSeconds: 300 });
  });

  it("progress keeps the message", () => {
    expect(reduceOAuthLogin(OAUTH_LOGIN_IDLE, { type: "progress", message: "Verifying…" }).state).toEqual({ phase: "progress", message: "Verifying…" });
  });
});

describe("reduceOAuthLogin: selection", () => {
  it("select_request enters the select phase with the options and token", () => {
    const t = reduceOAuthLogin({ phase: "connecting" }, { type: "select_request", message: "pick one", options: [{ id: "a", label: "A" }], token: "tok" });
    expect(t.state).toEqual({ phase: "select", message: "pick one", options: [{ id: "a", label: "A" }], token: "tok" });
    expect(t.closeStream).toBe(false);
  });
});

describe("reduceOAuthLogin: success and failure", () => {
  it("success reaches the success phase, closes the stream and fires the refresh", () => {
    const t = reduceOAuthLogin({ phase: "progress", message: "wait" }, { type: "success" });
    expect(t.state).toEqual({ phase: "success" });
    expect(t.closeStream).toBe(true);
    expect(t.succeeded).toBe(true);
  });

  it("error keeps the server message and closes the stream", () => {
    const t = reduceOAuthLogin({ phase: "connecting" }, { type: "error", message: "denied" });
    expect(t.state).toEqual({ phase: "error", message: "denied" });
    expect(t.closeStream).toBe(true);
    expect(t.succeeded).toBe(false);
  });

  it("a dropped stream becomes an error", () => {
    const t = reduceOAuthLogin({ phase: "auth", url: "u", instructions: null, token: "tok" }, { type: "stream_error" });
    expect(t.state).toEqual({ phase: "error", message: "Connection lost" });
    expect(t.closeStream).toBe(true);
  });

  it("a dropped stream after success stays successful", () => {
    const t = reduceOAuthLogin({ phase: "success" }, { type: "stream_error" });
    expect(t.state).toEqual({ phase: "success" });
    expect(t.closeStream).toBe(true);
    expect(t.succeeded).toBe(false);
  });
});

describe("reduceOAuthLogin: reset", () => {
  it("cancelled closes the stream and returns to idle", () => {
    const t = reduceOAuthLogin({ phase: "auth", url: "u", instructions: null, token: "tok" }, { type: "cancelled" });
    expect(t.state).toEqual({ phase: "idle" });
    expect(t.closeStream).toBe(true);
  });

  it("reset from any phase returns to idle", () => {
    for (const state of [
      { phase: "connecting" },
      { phase: "progress", message: "m" },
      { phase: "success" },
      { phase: "error", message: "e" },
    ] satisfies OAuthLoginState[]) {
      expect(reduceOAuthLogin(state, { type: "reset" }).state).toEqual({ phase: "idle" });
    }
  });
});

describe("oauth login helpers", () => {
  it("exposes the token only while the user is expected to paste one", () => {
    expect(oauthLoginToken({ phase: "auth", url: "u", instructions: null, token: "a" })).toBe("a");
    expect(oauthLoginToken({ phase: "prompt", message: "m", placeholder: null, token: "b" })).toBe("b");
    expect(oauthLoginToken({ phase: "select", message: "m", options: [], token: "c" })).toBe("c");
    expect(oauthLoginToken({ phase: "connecting" })).toBeNull();
    expect(oauthLoginToken({ phase: "success" })).toBeNull();
  });

  it("reports a login as working between start and a terminal phase", () => {
    expect(isOAuthLoginWorking({ phase: "connecting" })).toBe(true);
    expect(isOAuthLoginWorking({ phase: "auth", url: "u", instructions: null, token: "t" })).toBe(true);
    expect(isOAuthLoginWorking({ phase: "progress", message: "m" })).toBe(true);
    expect(isOAuthLoginWorking(OAUTH_LOGIN_IDLE)).toBe(false);
    expect(isOAuthLoginWorking({ phase: "success" })).toBe(false);
    expect(isOAuthLoginWorking({ phase: "error", message: "e" })).toBe(false);
  });

  it("reports whether any provider still has a login in flight", () => {
    expect(anyOAuthLoginInProgress([])).toBe(false);
    expect(anyOAuthLoginInProgress([OAUTH_LOGIN_IDLE, { phase: "success" }, { phase: "error", message: "e" }])).toBe(false);
    expect(anyOAuthLoginInProgress([OAUTH_LOGIN_IDLE, { phase: "connecting" }])).toBe(true);
    expect(anyOAuthLoginInProgress([{ phase: "auth", url: "u", instructions: null, token: "t" }])).toBe(true);
  });
});
