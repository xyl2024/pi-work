import { describe, expect, it } from "vitest";
import { LOGIN_PHASES, isLoginInProgress, type LoginPhase } from "@/lib/shared/channels-login";
import {
  CHANNELS_GUARDED_PHASES,
  isChannelsLeaveGuarded,
} from "@/lib/shared/channels-close";

const GUARDED: readonly LoginPhase[] = ["waiting", "scanned", "verifying"];
const NOT_GUARDED: readonly LoginPhase[] = [
  "verify_blocked",
  "redirected",
  "confirmed",
  "already_bound",
  "expired",
  "error",
];

describe("isChannelsLeaveGuarded", () => {
  it("asks before leaving while the user has an unfinished scan", () => {
    for (const phase of GUARDED) {
      expect(isChannelsLeaveGuarded(phase), phase).toBe(true);
    }
  });

  it("lets the user leave silently for every phase where nothing is lost", () => {
    for (const phase of NOT_GUARDED) {
      expect(isChannelsLeaveGuarded(phase), phase).toBe(false);
    }
  });

  it("lets the user leave silently when no login session exists", () => {
    expect(isChannelsLeaveGuarded(null)).toBe(false);
  });

  it("covers all nine phases, guarding exactly the running-action set", () => {
    expect([...GUARDED, ...NOT_GUARDED].slice().sort()).toEqual([...LOGIN_PHASES].slice().sort());
    expect(new Set([...GUARDED, ...NOT_GUARDED]).size).toBe(LOGIN_PHASES.length);
    expect(CHANNELS_GUARDED_PHASES).toEqual(GUARDED);
  });

  it("guards a smaller set than the phases that keep the login polling", () => {
    for (const phase of LOGIN_PHASES) {
      if (isLoginInProgress(phase)) continue;
      expect(isChannelsLeaveGuarded(phase), phase).toBe(false);
    }
    for (const phase of GUARDED) expect(isLoginInProgress(phase), phase).toBe(true);
  });
});
