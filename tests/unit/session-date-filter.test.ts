import { describe, expect, it } from "vitest";
import { appendSessionDateRange, localSessionDay, matchesSessionDate, parseSessionDateRange } from "@/lib/shared/session-date-filter";

describe("today session date range", () => {
  it("includes local midnight and excludes the following midnight", () => {
    const range = localSessionDay(new Date(2026, 4, 3, 12));
    expect(matchesSessionDate(new Date(2026, 4, 3).toISOString(), range)).toBe(true);
    expect(matchesSessionDate(new Date(range.from - 1).toISOString(), range)).toBe(false);
    expect(matchesSessionDate(new Date(range.before - 1).toISOString(), range)).toBe(true);
    expect(matchesSessionDate(new Date(2026, 4, 4).toISOString(), range)).toBe(false);
    expect(matchesSessionDate("invalid", range)).toBe(false);
  });

  it("uses consecutive local midnights on DST transition days", () => {
    for (const day of [new Date(2024, 2, 10, 12), new Date(2024, 10, 3, 12)]) {
      const range = localSessionDay(day);
      expect(new Date(range.from).getHours()).toBe(0);
      expect(new Date(range.before).getHours()).toBe(0);
      expect(new Date(range.before).getDate()).toBe(day.getDate() + 1);
    }
  });

  it("transports browser-local instants independently of the server timezone", () => {
    const range = localSessionDay(new Date(2026, 4, 3, 12));
    const params = new URLSearchParams();
    appendSessionDateRange(params, range);
    expect(params.get("modifiedFrom")).toBe(new Date(range.from).toISOString());
    expect(parseSessionDateRange(params)).toEqual(range);
  });

  it("keeps the cached today boundaries separate from the normal list filter", () => {
    const range = localSessionDay(new Date(2026, 4, 3, 12));
    const params = new URLSearchParams({ limit: "5" });
    appendSessionDateRange(params, range, "today");
    expect(parseSessionDateRange(params)).toBeNull();
    expect(parseSessionDateRange(params, "today")).toEqual(range);
  });

  it("keeps old callers unfiltered and rejects invalid ranges", () => {
    expect(parseSessionDateRange(new URLSearchParams())).toBeNull();
    expect(matchesSessionDate("anything", null)).toBe(true);
    for (const query of [
      "modifiedFrom=2026-05-03",
      "modifiedBefore=2026-05-04",
      "modifiedFrom=bad&modifiedBefore=2026-05-04",
      "modifiedFrom=2026-05-04&modifiedBefore=2026-05-03",
      "modifiedFrom=2026-05-03&modifiedBefore=2026-05-03",
    ]) expect(parseSessionDateRange(new URLSearchParams(query))).toBeUndefined();
  });
});
