import { describe, expect, it } from "vitest";
import {
  CHAT_BOTTOM_FROST_MASK_BLUR_RADIUS_PX,
  CHAT_BOTTOM_FROST_MASK_HEIGHT_PX,
  CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY,
  CHAT_BOTTOM_FROST_MASK_GRADIENT_STOPS,
  isChatBottomFrostMaskVisible,
} from "@/lib/shared/chatBottomFrostMask";

describe("isChatBottomFrostMaskVisible", () => {
  it("is visible in the normal state", () => {
    expect(isChatBottomFrostMaskVisible({ pendingAskUserQuestions: false })).toBe(true);
  });

  it("hides while an Ask User Questions panel is pending", () => {
    expect(isChatBottomFrostMaskVisible({ pendingAskUserQuestions: true })).toBe(false);
  });
});

describe("frost mask visual parameters", () => {
  it("peels ~110px off the bottom above the composer", () => {
    expect(CHAT_BOTTOM_FROST_MASK_HEIGHT_PX).toBe(110);
  });

  it("ends near 90% opacity so content is only faintly visible", () => {
    expect(CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY).toBe(0.9);
    expect(CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY).toBeGreaterThan(0);
    expect(CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY).toBeLessThanOrEqual(1);
  });

  it("blurs gently around 8px", () => {
    expect(CHAT_BOTTOM_FROST_MASK_BLUR_RADIUS_PX).toBe(8);
  });

  it("ramps from fully transparent at the top to peak opacity at the bottom", () => {
    expect(CHAT_BOTTOM_FROST_MASK_GRADIENT_STOPS).toEqual([
      { offsetPx: 0, opacity: 0 },
      { offsetPx: CHAT_BOTTOM_FROST_MASK_HEIGHT_PX, opacity: CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY },
    ]);
  });
});
