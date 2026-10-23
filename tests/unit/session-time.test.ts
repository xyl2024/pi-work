import { describe, expect, it } from "vitest";
import { sessionDayDiff, sessionTimeLabel } from "@/lib/shared/session-time";

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

  it("uses whole minutes within an hour and whole hours within 24 hours", () => {
    const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    expect(sessionTimeLabel(ago(0.5), now)).toEqual({ kind: "minutes", minutes: 30 });
    expect(sessionTimeLabel(ago(1 / 120), now)).toEqual({ kind: "just-now" });
    expect(sessionTimeLabel(ago(3.5), now)).toEqual({ kind: "hours", hours: 3 });
    expect(sessionTimeLabel(ago(23.9), now)).toEqual({ kind: "hours", hours: 23 });
    expect(sessionTimeLabel(ago(24), now)).toEqual({ kind: "relative", days: 1 });
  });

  it("clamps future timestamps to just now", () => {
    expect(sessionTimeLabel(at(2024, 9, 20), now)).toEqual({ kind: "just-now" });
  });

  it("uses relative day labels after 24 hours through 3 calendar days back", () => {
    expect(sessionTimeLabel(at(2024, 9, 17, 10), now)).toEqual({ kind: "relative", days: 1 });
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
