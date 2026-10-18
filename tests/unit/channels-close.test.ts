import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import { LOGIN_PHASES, isLoginInProgress, type LoginPhase } from "@/lib/shared/channels-login";
import {
  CHANNELS_GUARDED_PHASES,
  CHANNELS_LOGIN_CLOSE_CONFIRM,
  selectChannelsCloseConfirm,
} from "@/lib/shared/channels-close";

/**
 * The channels panel's close guard (lib/shared/channels-close.ts). One
 * question: would closing the panel tab abandon a live scan login? Driven as
 * plain data — the shell is the only caller and maps the returned i18n keys
 * through `t()`. The panel holds no draft (every input writes through), so
 * "a login session in flight" is the whole rule.
 */

/**
 * `redirected` is the one phase the issue left to the implementer ("跟随其实际
 * 语义决定"). It is NOT guarded here, on purpose: the server is mid-switch to
 * another IDC node and the client has no action to take on it, so the issue's
 * guard rule stops at `verifying`. `verify_blocked` is excluded too — too many
 * wrong pairing codes means the session can no longer confirm without a fresh
 * QR, so nothing is lost by closing.
 */
const GUARDED: readonly LoginPhase[] = ["waiting", "scanned", "verifying"];
const NOT_GUARDED: readonly LoginPhase[] = [
  "verify_blocked",
  "redirected",
  "confirmed",
  "already_bound",
  "expired",
  "error",
];

describe("selectChannelsCloseConfirm", () => {
  it("asks before closing while the user has an unfinished scan", () => {
    for (const phase of GUARDED) {
      expect(selectChannelsCloseConfirm({ phase }), phase).toEqual(
        CHANNELS_LOGIN_CLOSE_CONFIRM,
      );
    }
  });

  it("lets the tab close silently for every phase where nothing is lost", () => {
    for (const phase of NOT_GUARDED) {
      expect(selectChannelsCloseConfirm({ phase }), phase).toBeNull();
    }
  });

  it("lets the tab close silently when no login session exists", () => {
    expect(selectChannelsCloseConfirm({ phase: null })).toBeNull();
  });

  it("covers all nine phases, guarding exactly the running-action set", () => {
    expect([...GUARDED, ...NOT_GUARDED].slice().sort()).toEqual([...LOGIN_PHASES].slice().sort());
    expect(new Set([...GUARDED, ...NOT_GUARDED]).size).toBe(LOGIN_PHASES.length);
    expect(CHANNELS_GUARDED_PHASES).toEqual(GUARDED);
  });

  it("labels the close button Close — the tab is being closed, not saved", () => {
    expect(CHANNELS_LOGIN_CLOSE_CONFIRM.confirmLabelKey).toBe("Close");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[CHANNELS_LOGIN_CLOSE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[CHANNELS_LOGIN_CLOSE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[CHANNELS_LOGIN_CLOSE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});

/**
 * The poll predicate (lib/shared/channels-login.ts) is a different question from
 * the guard: it keeps the 2s poll alive for every phase the user can still act
 * on, which is a wider set than the guarded one.
 */
describe("isLoginInProgress", () => {
  it("keeps polling for the live phases, including verify_blocked / redirected", () => {
    const running: LoginPhase[] = ["waiting", "scanned", "verifying", "verify_blocked", "redirected"];
    for (const phase of running) expect(isLoginInProgress(phase), phase).toBe(true);
  });

  it("stops polling for the terminal phases", () => {
    const terminal: LoginPhase[] = ["confirmed", "already_bound", "expired", "error"];
    for (const phase of terminal) expect(isLoginInProgress(phase), phase).toBe(false);
  });

  it("treats no session as not in progress", () => {
    expect(isLoginInProgress(null)).toBe(false);
  });
});
