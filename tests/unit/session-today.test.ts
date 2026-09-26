import { describe, expect, it } from "vitest";
import { startOfLocalDayMs, isSessionActiveSince, parseModifiedSince } from "@/lib/shared/session-today";

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
