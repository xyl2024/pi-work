import { describe, expect, it } from "vitest";
import { startOfLocalDayMs, isSessionActiveSince, parseModifiedSince, sessionDayDiff, sessionTimeLabel } from "@/lib/shared/session-today";

/**
 * Pure module behind the sidebar's "Today's sessions" view:
 *   - the client turns "now" into the local calendar-day boundary it sends
 *     to `/api/sessions?modifiedSince=<epoch ms>`;
 *   - the server decides which rows fall inside that window.
 *
 * The boundary is a LOCAL calendar day (not UTC): "today" means the user's
 * today, which matters when the server runs in a different timezone.
 */
describe("startOfLocalDayMs", () => {
  it("returns local midnight of the calendar day containing now", () => {
    const now = new Date(2024, 4, 15, 13, 45, 30, 123);
    const expected = new Date(2024, 4, 15, 0, 0, 0, 0).getTime();
    expect(startOfLocalDayMs(now)).toBe(expected);
  });

  it("is idempotent when now is already local midnight", () => {
    const midnight = new Date(2024, 4, 15, 0, 0, 0, 0);
    expect(startOfLocalDayMs(midnight)).toBe(midnight.getTime());
  });

  it("never lands in the future", () => {
    const now = new Date(2024, 0, 1, 0, 0, 0, 1);
    expect(startOfLocalDayMs(now)).toBeLessThanOrEqual(now.getTime());
  });
});

describe("isSessionActiveSince", () => {
  const since = Date.parse("2024-05-15T00:00:00.000Z");

  it("counts a session modified exactly at the boundary (inclusive)", () => {
    expect(isSessionActiveSince({ modified: "2024-05-15T00:00:00.000Z" }, since)).toBe(true);
  });

  it("rejects a session modified one millisecond before the boundary", () => {
    expect(isSessionActiveSince({ modified: "2024-05-14T23:59:59.999Z" }, since)).toBe(false);
  });

  it("counts a session modified after the boundary", () => {
    expect(isSessionActiveSince({ modified: "2024-05-15T08:30:00.000Z" }, since)).toBe(true);
  });

  it("rejects a session whose modified timestamp cannot be parsed", () => {
    expect(isSessionActiveSince({ modified: "not-a-date" }, since)).toBe(false);
  });
});

describe("sessionDayDiff", () => {
  const now = new Date(2024, 9, 18, 10, 0, 0);
  const local = (d: Date) => d.toISOString();

  it("counts calendar days, not 24h windows", () => {
    // 00:05 today and 23:55 yesterday are 2 minutes apart but a full day.
    expect(sessionDayDiff(new Date(2024, 9, 18, 0, 5).toISOString(), now)).toBe(0);
    expect(sessionDayDiff(new Date(2024, 9, 17, 23, 55).toISOString(), now)).toBe(1);
  });

  it("clamps future timestamps (clock skew) to today", () => {
    expect(sessionDayDiff(new Date(2024, 9, 20, 9, 0).toISOString(), now)).toBe(0);
  });

  it("returns null for an unparseable timestamp", () => {
    expect(sessionDayDiff("not-a-date", now)).toBeNull();
  });

  it("handles a DST-crossing span without off-by-one", () => {
    // 2024-11-03 is the US DST fall-back day: 24h + 1h apart in local time.
    const before = new Date(2024, 10, 2, 12, 0);
    const after = new Date(2024, 10, 4, 12, 0);
    expect(sessionDayDiff(local(before), after)).toBe(2);
  });
});

describe("sessionTimeLabel", () => {
  const now = new Date(2024, 9, 18, 10, 0, 0);
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it("uses relative labels for 0..3 calendar days back", () => {
    expect(sessionTimeLabel(at(2024, 9, 18), now)).toEqual({ kind: "relative", days: 0 });
    expect(sessionTimeLabel(at(2024, 9, 17), now)).toEqual({ kind: "relative", days: 1 });
    expect(sessionTimeLabel(at(2024, 9, 16), now)).toEqual({ kind: "relative", days: 2 });
    expect(sessionTimeLabel(at(2024, 9, 15), now)).toEqual({ kind: "relative", days: 3 });
  });

  it("falls back to a zero-padded MM.DD date on day 4", () => {
    expect(sessionTimeLabel(at(2024, 9, 14), now)).toEqual({ kind: "date", text: "10.14" });
  });

  it("zero-pads single-digit months and days", () => {
    expect(sessionTimeLabel(at(2024, 0, 5), now)).toEqual({ kind: "date", text: "01.05" });
  });

  it("returns null for an unparseable timestamp", () => {
    expect(sessionTimeLabel("nope", now)).toBeNull();
  });
});

describe("parseModifiedSince", () => {
  it("parses a numeric epoch-ms string", () => {
    expect(parseModifiedSince("1727000000000")).toBe(1727000000000);
  });

  it("treats epoch zero as a real boundary", () => {
    expect(parseModifiedSince("0")).toBe(0);
  });

  it("returns null for an absent parameter", () => {
    expect(parseModifiedSince(null)).toBeNull();
  });

  it("returns null for an empty value", () => {
    expect(parseModifiedSince("")).toBeNull();
  });

  it("returns null for a non-numeric value", () => {
    expect(parseModifiedSince("not-a-number")).toBeNull();
  });

  it("returns null for a non-finite value", () => {
    expect(parseModifiedSince("Infinity")).toBeNull();
  });
});
