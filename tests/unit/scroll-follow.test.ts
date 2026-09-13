import { describe, expect, it } from "vitest";
import {
  INITIAL_SCROLL_FOLLOW_STATE,
  NO_FOLLOW_CHANGE,
  SCROLL_BOTTOM_THRESHOLD_PX,
  decideEntryScroll,
  decideScrollFollowOnBottom,
  decideScrollFollowOnGrowth,
  decideScrollFollowOnScroll,
  decideScrollFollowOnTouchScroll,
  decideScrollFollowOnWheel,
  distanceFromBottom,
  elementScrollTop,
  resolveScrollFollow,
  type ScrollMetrics,
} from "@/lib/shared/scroll-follow";

/** A scrollport 600px tall holding 5000px of content, scrolled to `scrollTop`. */
function metrics(scrollTop: number, scrollHeight = 5000, clientHeight = 600): ScrollMetrics {
  return { scrollHeight, scrollTop, clientHeight };
}

/** ...with the given distance left below the viewport. */
function metricsWithDistanceFromBottom(distance: number): ScrollMetrics {
  return metrics(5000 - 600 - distance);
}

describe("distanceFromBottom", () => {
  it("is the layout left below the viewport", () => {
    expect(distanceFromBottom(metrics(4000))).toBe(400);
  });

  it("is zero at the very bottom and positive above it", () => {
    expect(distanceFromBottom(metrics(4400))).toBe(0);
    expect(distanceFromBottom(metrics(4390))).toBe(10);
  });
});

describe("elementScrollTop", () => {
  it("converts a row's viewport rect into a scrollport offset", () => {
    expect(
      elementScrollTop({ containerTop: 100, elementTop: 340, containerScrollTop: 1200 }),
    ).toBe(1440);
  });

  it("handles a row above the scrollport top", () => {
    expect(
      elementScrollTop({ containerTop: 100, elementTop: -40, containerScrollTop: 1200 }),
    ).toBe(1060);
  });
});

describe("decideScrollFollowOnWheel", () => {
  it("starts following with no affordance", () => {
    expect(INITIAL_SCROLL_FOLLOW_STATE).toEqual({ paused: false, showToBottom: false });
  });

  it("pauses and shows the button on an upward wheel", () => {
    expect(decideScrollFollowOnWheel(-1)).toEqual({
      follow: { paused: true, showToBottom: true },
      command: "none",
    });
  });

  it("changes nothing on a downward wheel", () => {
    // Scrolling down while still above the bottom must not resume following —
    // only reaching the bottom (a scroll event) does — and it must not flip
    // the affordance either.
    expect(decideScrollFollowOnWheel(120)).toEqual(NO_FOLLOW_CHANGE);
    expect(decideScrollFollowOnWheel(0)).toEqual(NO_FOLLOW_CHANGE);
  });
});

describe("decideScrollFollowOnTouchScroll", () => {
  it("always pauses: a touch drag has no direction to read", () => {
    expect(decideScrollFollowOnTouchScroll()).toEqual({
      follow: { paused: true, showToBottom: true },
      command: "none",
    });
  });
});

describe("decideScrollFollowOnScroll", () => {
  it("follows while inside the bottom threshold", () => {
    expect(
      decideScrollFollowOnScroll(metricsWithDistanceFromBottom(SCROLL_BOTTOM_THRESHOLD_PX - 1)),
    ).toEqual({ follow: { paused: false, showToBottom: false }, command: "none" });
  });

  it("follows exactly at the bottom", () => {
    expect(decideScrollFollowOnScroll(metricsWithDistanceFromBottom(0))).toEqual({
      follow: { paused: false, showToBottom: false },
      command: "none",
    });
  });

  it("pauses at the threshold and above it", () => {
    for (const distance of [SCROLL_BOTTOM_THRESHOLD_PX, SCROLL_BOTTOM_THRESHOLD_PX + 1, 500]) {
      expect(decideScrollFollowOnScroll(metricsWithDistanceFromBottom(distance))).toEqual({
        follow: { paused: true, showToBottom: true },
        command: "none",
      });
    }
  });

  it("changes nothing before the scrollport is mounted", () => {
    expect(decideScrollFollowOnScroll(null)).toEqual(NO_FOLLOW_CHANGE);
  });
});

describe("decideScrollFollowOnGrowth", () => {
  it("scrolls to the bottom when the view was at the bottom before growing", () => {
    expect(
      decideScrollFollowOnGrowth(false, {
        heightDelta: 120,
        metrics: metricsWithDistanceFromBottom(120),
        isActive: true,
      }),
    ).toEqual({ follow: { paused: false, showToBottom: false }, command: "toBottomInstant" });
  });

  it("judges the growth against the distance from before it happened", () => {
    // 60px of viewport growth plus 30px already past the threshold is still
    // inside the 90px distance the chat had before the growth.
    const decision = decideScrollFollowOnGrowth(false, {
      heightDelta: 60,
      metrics: metricsWithDistanceFromBottom(90),
      isActive: true,
    });
    expect(decision.command).toBe("toBottomInstant");
  });

  it("does not pull down a view that was scrolled up before the growth", () => {
    expect(
      decideScrollFollowOnGrowth(false, {
        heightDelta: 60,
        metrics: metricsWithDistanceFromBottom(SCROLL_BOTTOM_THRESHOLD_PX + 1 + 60),
        isActive: true,
      }),
    ).toEqual(NO_FOLLOW_CHANGE);
  });

  it("leaves a paused view exactly as it was", () => {
    expect(
      decideScrollFollowOnGrowth(true, {
        heightDelta: 120,
        metrics: metricsWithDistanceFromBottom(120),
        isActive: true,
      }),
    ).toEqual(NO_FOLLOW_CHANGE);
  });

  it("ignores a shrink and a zero delta", () => {
    const grown = metricsWithDistanceFromBottom(120);
    expect(
      decideScrollFollowOnGrowth(false, { heightDelta: -5, metrics: grown, isActive: true }),
    ).toEqual(NO_FOLLOW_CHANGE);
    expect(
      decideScrollFollowOnGrowth(false, { heightDelta: 0, metrics: grown, isActive: true }),
    ).toEqual(NO_FOLLOW_CHANGE);
  });

  it("ignores a background tab: it has no layout to judge", () => {
    expect(
      decideScrollFollowOnGrowth(true, { heightDelta: 120, metrics: null, isActive: false }),
    ).toEqual(NO_FOLLOW_CHANGE);
    expect(
      decideScrollFollowOnGrowth(false, { heightDelta: 120, metrics: null, isActive: true }),
    ).toEqual(NO_FOLLOW_CHANGE);
  });
});

describe("decideScrollFollowOnBottom", () => {
  it("resumes following and asks for a smooth scroll", () => {
    expect(decideScrollFollowOnBottom()).toEqual({
      follow: { paused: false, showToBottom: false },
      command: "toBottomSmooth",
    });
  });
});

describe("resolveScrollFollow", () => {
  it("resumes following without a scroll of its own", () => {
    expect(resolveScrollFollow()).toEqual({
      follow: { paused: false, showToBottom: false },
      command: "none",
    });
  });
});

describe("decideEntryScroll", () => {
  it("does nothing while there are no messages", () => {
    expect(
      decideEntryScroll({ messageCount: 0, pendingScrollToUser: true, initialScrollDone: false }),
    ).toEqual({ command: "none", pendingScrollToUser: true, initialScrollDone: false });
  });

  it("sticks the first entry to the bottom, instantly", () => {
    expect(
      decideEntryScroll({ messageCount: 1, pendingScrollToUser: false, initialScrollDone: false }),
    ).toEqual({ command: "toBottomInstant", pendingScrollToUser: false, initialScrollDone: true });
  });

  it("lands the last user message at the top after a send, smoothly", () => {
    expect(
      decideEntryScroll({ messageCount: 4, pendingScrollToUser: true, initialScrollDone: true }),
    ).toEqual({ command: "userMessageToTop", pendingScrollToUser: false, initialScrollDone: true });
  });

  it("prefers the send landing over the first-entry stick when both apply", () => {
    expect(
      decideEntryScroll({ messageCount: 1, pendingScrollToUser: true, initialScrollDone: false }),
    ).toEqual({ command: "userMessageToTop", pendingScrollToUser: false, initialScrollDone: true });
  });

  it("moves nothing on later growth", () => {
    // Streaming is followed by the nested live viewport, not by the page-level
    // scrollport, so a new message must not move the outer scroll position.
    expect(
      decideEntryScroll({ messageCount: 9, pendingScrollToUser: false, initialScrollDone: true }),
    ).toEqual({ command: "none", pendingScrollToUser: false, initialScrollDone: true });
  });

  it("consumes the send trigger only once", () => {
    const first = decideEntryScroll({
      messageCount: 2,
      pendingScrollToUser: true,
      initialScrollDone: true,
    });
    const second = decideEntryScroll({
      messageCount: 3,
      pendingScrollToUser: first.pendingScrollToUser,
      initialScrollDone: first.initialScrollDone,
    });
    expect(second).toEqual({ command: "none", pendingScrollToUser: false, initialScrollDone: true });
  });
});
