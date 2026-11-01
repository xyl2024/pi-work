import { describe, expect, it } from "vitest";
import {
  STREAMING_STATUS_ROW_HEIGHT_PX,
  STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX,
  STREAMING_TRANSCRIPT_PADDING_TOP_PX,
  STREAMING_USER_MESSAGE_GAP_PX,
  STREAMING_VIEWPORT_ABSOLUTE_MAX_HEIGHT_PX,
  STREAMING_VIEWPORT_MARGIN_BOTTOM_PX,
  STREAMING_VIEWPORT_MAX_WINDOW_RATIO,
  STREAMING_VIEWPORT_MIN_HEIGHT_PX,
  STREAMING_VIEWPORT_TRAILING_SPACE_PX,
  resolveStreamingViewportHeight,
  resolveStreamingViewportHeightFromGeometry,
} from "@/lib/shared/streamingViewportHeight";

function availableFor(transcriptClientHeight: number): number {
  return (
    transcriptClientHeight -
    STREAMING_TRANSCRIPT_PADDING_TOP_PX -
    STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX -
    STREAMING_VIEWPORT_TRAILING_SPACE_PX
  );
}

describe("resolveStreamingViewportHeight", () => {
  it("fills the transcript minus the user message block and the gap on a 1080p window", () => {
    const transcriptClientHeight = 836;
    const userMessageBlockHeight = 112;
    expect(
      resolveStreamingViewportHeight({ transcriptClientHeight, userMessageBlockHeight, windowHeight: 1080 }),
    ).toBe(availableFor(transcriptClientHeight) - userMessageBlockHeight - STREAMING_USER_MESSAGE_GAP_PX);
  });

  it("keeps the avatar row, the user bubble and the viewport on screen on a 768p window", () => {
    const transcriptClientHeight = 620;
    const userMessageBlockHeight = 112;
    const height = resolveStreamingViewportHeight({
      transcriptClientHeight,
      userMessageBlockHeight,
      windowHeight: 768,
    });
    const occupied =
      STREAMING_TRANSCRIPT_PADDING_TOP_PX +
      userMessageBlockHeight +
      STREAMING_USER_MESSAGE_GAP_PX +
      height +
      STREAMING_VIEWPORT_MARGIN_BOTTOM_PX +
      STREAMING_STATUS_ROW_HEIGHT_PX +
      STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX;
    expect(occupied).toBeLessThanOrEqual(transcriptClientHeight);
  });

  it("reserves the status row below the viewport so the user message is not pushed off screen", () => {
    const transcriptClientHeight = 700;
    const height = resolveStreamingViewportHeight({
      transcriptClientHeight,
      userMessageBlockHeight: 0,
      windowHeight: 1440,
    });
    expect(height).toBe(
      availableFor(transcriptClientHeight) - STREAMING_USER_MESSAGE_GAP_PX,
    );
    expect(
      height + STREAMING_VIEWPORT_TRAILING_SPACE_PX + STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX,
    ).toBeLessThanOrEqual(transcriptClientHeight);
  });

  it("stops at the window-relative ceiling on tall screens", () => {
    const windowHeight = 1080;
    expect(resolveStreamingViewportHeight({ transcriptClientHeight: 4000, userMessageBlockHeight: 0, windowHeight })).toBe(
      windowHeight * STREAMING_VIEWPORT_MAX_WINDOW_RATIO,
    );
  });

  it("stops at the absolute ceiling on very tall screens", () => {
    expect(resolveStreamingViewportHeight({ transcriptClientHeight: 4000, userMessageBlockHeight: 0, windowHeight: 2160 })).toBe(
      STREAMING_VIEWPORT_ABSOLUTE_MAX_HEIGHT_PX,
    );
  });

  it("falls back to the floor when the available room is too small", () => {
    expect(resolveStreamingViewportHeight({ transcriptClientHeight: 300, userMessageBlockHeight: 112, windowHeight: 600 })).toBe(
      STREAMING_VIEWPORT_MIN_HEIGHT_PX,
    );
  });

  it("clamps a negative budget to the floor", () => {
    expect(resolveStreamingViewportHeight({ transcriptClientHeight: 0, userMessageBlockHeight: 400, windowHeight: 600 })).toBe(
      STREAMING_VIEWPORT_MIN_HEIGHT_PX,
    );
  });

  it("never returns less than the floor when a huge user message eats the budget", () => {
    expect(resolveStreamingViewportHeight({ transcriptClientHeight: 1200, userMessageBlockHeight: 1000, windowHeight: 1440 })).toBe(
      STREAMING_VIEWPORT_MIN_HEIGHT_PX,
    );
  });

  it("treats a missing user message block as zero height", () => {
    const transcriptClientHeight = 700;
    expect(resolveStreamingViewportHeight({ transcriptClientHeight, userMessageBlockHeight: -20, windowHeight: 1440 })).toBe(
      availableFor(transcriptClientHeight) - STREAMING_USER_MESSAGE_GAP_PX,
    );
  });
});

describe("resolveStreamingViewportHeightFromGeometry", () => {
  const base = {
    currentViewportHeight: 600,
    transcriptClientHeight: 900,
    transcriptPaddingTop: STREAMING_TRANSCRIPT_PADDING_TOP_PX,
    windowHeight: 1080,
  };
  const visibleBudget = base.transcriptClientHeight - base.transcriptPaddingTop;

  it("keeps the current height when the space below the user message matches the visible budget", () => {
    expect(
      resolveStreamingViewportHeightFromGeometry({
        ...base,
        transcriptScrollHeight: 2000 + visibleBudget,
        userMessageTopInContent: 2000,
      }),
    ).toBe(base.currentViewportHeight);
  });

  it("grows by the shortfall of the space below the user message", () => {
    expect(
      resolveStreamingViewportHeightFromGeometry({
        ...base,
        transcriptScrollHeight: 2000 + visibleBudget - STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX,
        userMessageTopInContent: 2000,
      }),
    ).toBe(base.currentViewportHeight + STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX);
  });

  it("shrinks by the overflow of the space below the user message", () => {
    const overflow = 120;

    expect(
      resolveStreamingViewportHeightFromGeometry({
        ...base,
        transcriptScrollHeight: 2000 + visibleBudget + overflow,
        userMessageTopInContent: 2000,
      }),
    ).toBe(base.currentViewportHeight - overflow);
  });

  it("clamps the geometric correction to the window ceiling", () => {
    const ceiling = Math.min(
      base.windowHeight * STREAMING_VIEWPORT_MAX_WINDOW_RATIO,
      STREAMING_VIEWPORT_ABSOLUTE_MAX_HEIGHT_PX,
    );
    const userMessageTopInContent = 2000;
    const overflowAboveBudget = 500;

    expect(
      resolveStreamingViewportHeightFromGeometry({
        ...base,
        currentViewportHeight: ceiling,
        transcriptScrollHeight: userMessageTopInContent + visibleBudget - overflowAboveBudget,
        userMessageTopInContent,
      }),
    ).toBe(ceiling);
  });
});
