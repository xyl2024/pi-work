import { describe, expect, it } from "vitest";
import type { ScrollMetrics } from "@/lib/shared/scroll-follow";
import {
  NO_SCROLL_EDGES,
  SCROLL_EDGE_THRESHOLD_PX,
  SCROLL_FADE_PX,
  SESSION_ROW_HEIGHT_PX,
  SIDEBAR_LIST_PADDING_Y_PX,
  TODAY_MIN_ROWS,
  TODAY_VISIBLE_ROWS,
  decideScrollEdges,
  scrollFadeMaskImage,
  sidebarListHeightPx,
} from "@/lib/shared/sidebar-section";

/** A scrollport `clientHeight` tall holding `scrollHeight` of content, scrolled to `scrollTop`. */
function metrics(scrollTop: number, scrollHeight: number, clientHeight: number): ScrollMetrics {
  return { scrollHeight, scrollTop, clientHeight };
}

/** The widths of every px stop in a mask gradient. */
function fadeWidths(mask: string): number[] {
  return [...mask.matchAll(/(\d+)px/g)].map((match) => Number(match[1]));
}

describe("sidebarListHeightPx", () => {
  it("is the rows plus the list padding", () => {
    expect(sidebarListHeightPx(3)).toBe(96);
  });

  it("keeps the floor at one row — exactly the list's existing minHeight", () => {
    expect(sidebarListHeightPx(1)).toBe(40);
  });

  it("caps the today list at six rows", () => {
    expect(sidebarListHeightPx(6)).toBe(180);
  });

  it("is the padding alone for zero rows", () => {
    expect(sidebarListHeightPx(0)).toBe(SIDEBAR_LIST_PADDING_Y_PX);
  });

  it("grows monotonically with each row", () => {
    expect(sidebarListHeightPx(2)).toBeGreaterThan(sidebarListHeightPx(1));
    expect(sidebarListHeightPx(7)).toBeGreaterThan(sidebarListHeightPx(6));
  });
});

describe("today section constants", () => {
  it("caps above the floor", () => {
    expect(TODAY_MIN_ROWS).toBeLessThan(TODAY_VISIBLE_ROWS);
  });

  it("pins the row height, padding, cap and fade width", () => {
    expect(SESSION_ROW_HEIGHT_PX).toBe(28);
    expect(SIDEBAR_LIST_PADDING_Y_PX).toBe(12);
    expect(TODAY_VISIBLE_ROWS).toBe(6);
    expect(TODAY_MIN_ROWS).toBe(1);
    expect(SCROLL_FADE_PX).toBe(16);
  });
});

describe("decideScrollEdges", () => {
  it("hides nothing while the container is not mounted", () => {
    expect(decideScrollEdges(null)).toEqual(NO_SCROLL_EDGES);
  });

  it("at the top hides only the bottom", () => {
    expect(decideScrollEdges(metrics(0, 500, 180))).toEqual({ top: false, bottom: true });
  });

  it("in the middle hides both sides", () => {
    expect(decideScrollEdges(metrics(100, 500, 180))).toEqual({ top: true, bottom: true });
  });

  it("at the very bottom hides only the top", () => {
    expect(decideScrollEdges(metrics(320, 500, 180))).toEqual({ top: true, bottom: false });
  });

  it("hides nothing when the content does not overflow", () => {
    expect(decideScrollEdges(metrics(0, 120, 180))).toEqual(NO_SCROLL_EDGES);
    expect(decideScrollEdges(metrics(0, 180, 180))).toEqual(NO_SCROLL_EDGES);
  });

  it("treats a sub-pixel scroll as still at the edge", () => {
    const halfPxFromTop = metrics(0.5, 500, 180); // distanceFromBottom = 319.5
    expect(decideScrollEdges(halfPxFromTop)).toEqual({ top: false, bottom: true });

    const halfPxUpFromBottom = metrics(319.5, 500, 180);
    expect(decideScrollEdges(halfPxUpFromBottom)).toEqual({ top: true, bottom: false });
  });

  it("counts a scroll past the sub-pixel slack as away from the edge", () => {
    expect(decideScrollEdges(metrics(SCROLL_EDGE_THRESHOLD_PX + 1, 500, 180)).top).toBe(true);
  });
});

describe("scrollFadeMaskImage", () => {
  it("applies no mask when neither side hides content", () => {
    expect(scrollFadeMaskImage(NO_SCROLL_EDGES)).toBeUndefined();
  });

  it("fades only the bottom when scrolled to the top", () => {
    const mask = scrollFadeMaskImage({ top: false, bottom: true })!;
    // Starts opaque, ends transparent: the hidden side is the bottom.
    expect(mask).toMatch(/linear-gradient\(to bottom, black/);
    expect(mask).toContain("transparent 100%");
    expect(mask).not.toContain("transparent 0");
  });

  it("fades only the top when scrolled to the bottom", () => {
    const mask = scrollFadeMaskImage({ top: true, bottom: false })!;
    expect(mask).toContain("transparent 0");
    expect(mask).not.toContain("transparent 100%");
  });

  it("fades both ends when content is hidden on both sides", () => {
    const mask = scrollFadeMaskImage({ top: true, bottom: true })!;
    expect(mask).toContain("transparent 0");
    expect(mask).toContain("transparent 100%");
  });

  it("uses SCROLL_FADE_PX as the fade width on every masked side", () => {
    expect(fadeWidths(scrollFadeMaskImage({ top: true, bottom: false })!)).toEqual([SCROLL_FADE_PX]);
    expect(fadeWidths(scrollFadeMaskImage({ top: false, bottom: true })!)).toEqual([SCROLL_FADE_PX]);
    expect(fadeWidths(scrollFadeMaskImage({ top: true, bottom: true })!)).toEqual([
      SCROLL_FADE_PX,
      SCROLL_FADE_PX,
    ]);
  });

  it("takes an explicit fade width", () => {
    expect(fadeWidths(scrollFadeMaskImage({ top: true, bottom: true }, 8)!)).toEqual([8, 8]);
  });
});
