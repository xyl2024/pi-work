import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  anchorDisplayText,
  monthLabel,
  weekRangeLabel,
} from "@/components/panels/plans/anchorText";

/**
 * The panel passes `useI18n`'s `t`; this rebuilds it from the real zh
 * dictionary, so a missing or re-worded key fails the test rather than being
 * papered over by a stub.
 */
const t = (key: string, params?: Record<string, string | number>) => {
  const template = ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
};

describe("plan anchor display text", () => {
  it("labels a cross-month week with its range and owning month", () => {
    // 2026-09-28 (Mon) – 2026-10-04 (Sun) is filed under September, so the
    // label has to say so (ADR-0006).
    expect(weekRangeLabel("2026-09-28", t, "zh")).toBe("9/28–10/4（属 2026年9月）");
  });

  it("leaves a week inside one month as a bare range", () => {
    expect(weekRangeLabel("2026-09-14", t, "zh")).toBe("9/14–9/20");
  });

  it("formats a month label in the caller's locale", () => {
    expect(monthLabel("2026-09", "zh")).toBe("2026年9月");
    expect(monthLabel("2026-09", "en")).toBe("Sep 2026");
  });

  it("words every anchor kind in one place", () => {
    expect(anchorDisplayText({ kind: "inbox" }, t, "zh")).toBeNull();
    expect(anchorDisplayText({ kind: "day", date: "2026-09-15" }, t, "zh")).toBe("2026-09-15");
    expect(anchorDisplayText({ kind: "day", date: "2026-09-15" }, t, "zh", "short")).toBe("09-15");
    expect(anchorDisplayText({ kind: "week", date: "2026-09-28" }, t, "zh")).toBe(
      "9/28–10/4（属 2026年9月）",
    );
    expect(anchorDisplayText({ kind: "month", month: "2026-09" }, t, "zh")).toBe("2026年9月");
  });
});
