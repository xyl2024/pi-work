import { describe, expect, it } from "vitest";
import {
  decideSessionNotifySave,
  isSessionNotifyBindingLocallySaved,
  parseSessionNotifyChannelId,
} from "@/lib/shared/session-notify-binding";

describe("parseSessionNotifyChannelId", () => {
  it("returns the trimmed channel id", () => {
    expect(parseSessionNotifyChannelId({ channelId: "wx-123", updatedAt: "2026-01-01T00:00:00Z" }))
      .toBe("wx-123");
    expect(parseSessionNotifyChannelId({ channelId: "  wx-123  " })).toBe("wx-123");
  });

  it("returns null for a missing or empty binding", () => {
    expect(parseSessionNotifyChannelId(null)).toBeNull();
    expect(parseSessionNotifyChannelId(undefined)).toBeNull();
    expect(parseSessionNotifyChannelId({})).toBeNull();
    expect(parseSessionNotifyChannelId({ channelId: "" })).toBeNull();
    expect(parseSessionNotifyChannelId({ channelId: "   " })).toBeNull();
  });

  it("returns null for a non-string channel id", () => {
    expect(parseSessionNotifyChannelId({ channelId: 42 })).toBeNull();
    expect(parseSessionNotifyChannelId({ channelId: { id: "x" } })).toBeNull();
    expect(parseSessionNotifyChannelId("wx-123")).toBeNull();
  });
});

describe("decideSessionNotifySave", () => {
  it("persists the pick once the session exists", () => {
    expect(
      decideSessionNotifySave({ currentSessionId: "01a01ffa-023", pickedChannelId: "wx-1", savedSessionId: null }),
    ).toEqual({ kind: "persist", sessionId: "01a01ffa-023", channelId: "wx-1" });
  });

  it("skips before the session exists", () => {
    expect(
      decideSessionNotifySave({ currentSessionId: null, pickedChannelId: "wx-1", savedSessionId: null }),
    ).toEqual({ kind: "skip" });
    expect(
      decideSessionNotifySave({ currentSessionId: undefined, pickedChannelId: "wx-1", savedSessionId: null }),
    ).toEqual({ kind: "skip" });
  });

  it("skips a missing pick", () => {
    expect(
      decideSessionNotifySave({ currentSessionId: "01a01ffa-023", pickedChannelId: null, savedSessionId: null }),
    ).toEqual({ kind: "skip" });
  });

  it("persists each session at most once", () => {
    expect(
      decideSessionNotifySave({
        currentSessionId: "01a01ffa-023",
        pickedChannelId: "wx-1",
        savedSessionId: "01a01ffa-023",
      }),
    ).toEqual({ kind: "skip" });
  });

  it("persists again for a different session", () => {
    expect(
      decideSessionNotifySave({
        currentSessionId: "01a01ffa-999",
        pickedChannelId: "wx-1",
        savedSessionId: "01a01ffa-023",
      }),
    ).toEqual({ kind: "persist", sessionId: "01a01ffa-999", channelId: "wx-1" });
  });
});

describe("isSessionNotifyBindingLocallySaved", () => {
  it("ignores disk for the session this window just wrote", () => {
    expect(
      isSessionNotifyBindingLocallySaved({ sessionId: "01a01ffa-023", savedSessionId: "01a01ffa-023" }),
    ).toBe(true);
  });

  it("trusts disk when nothing was written in memory", () => {
    expect(
      isSessionNotifyBindingLocallySaved({ sessionId: "01a01ffa-023", savedSessionId: null }),
    ).toBe(false);
  });

  it("trusts disk for a different session", () => {
    expect(
      isSessionNotifyBindingLocallySaved({ sessionId: "01a01ffa-023", savedSessionId: "01a01ffa-999" }),
    ).toBe(false);
  });
});
