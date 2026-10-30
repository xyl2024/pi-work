import { describe, expect, it } from "vitest";
import { computeEdgeScrollVelocity, keepPointerInRect } from "@/lib/client/tab-bar-autoscroll";

const rect = { left: 100, right: 500 };

describe("computeEdgeScrollVelocity", () => {
  it("returns 0 outside the edge zones", () => {
    expect(computeEdgeScrollVelocity(200, rect)).toBe(0);
    expect(computeEdgeScrollVelocity(400, rect)).toBe(0);
  });

  it("returns negative near the left edge and positive near the right edge", () => {
    expect(computeEdgeScrollVelocity(110, rect)).toBeLessThan(0);
    expect(computeEdgeScrollVelocity(490, rect)).toBeGreaterThan(0);
  });

  it("grows in magnitude as the pointer gets closer to an edge", () => {
    const farLeft = Math.abs(computeEdgeScrollVelocity(130, rect));
    const nearLeft = Math.abs(computeEdgeScrollVelocity(105, rect));
    expect(nearLeft).toBeGreaterThan(farLeft);

    const farRight = Math.abs(computeEdgeScrollVelocity(470, rect));
    const nearRight = Math.abs(computeEdgeScrollVelocity(495, rect));
    expect(nearRight).toBeGreaterThan(farRight);
  });

  it("caps the velocity at the given maximum", () => {
    const max = 10;
    expect(Math.abs(computeEdgeScrollVelocity(100, rect, { maxSpeed: max }))).toBeLessThanOrEqual(max);
    expect(Math.abs(computeEdgeScrollVelocity(500, rect, { maxSpeed: max }))).toBeLessThanOrEqual(max);
  });

  it("zeroes the velocity once the pointer leaves the container", () => {
    expect(computeEdgeScrollVelocity(99, rect)).toBe(0);
    expect(computeEdgeScrollVelocity(501, rect)).toBe(0);
  });

  it("hints a scroll direction even at the edge boundary", () => {
    expect(computeEdgeScrollVelocity(100, rect)).toBeLessThanOrEqual(0);
    expect(computeEdgeScrollVelocity(500, rect)).toBeGreaterThanOrEqual(0);
  });
});

describe("keepPointerInRect", () => {
  it("passes through coordinates inside the container", () => {
    expect(keepPointerInRect(120, rect)).toBe(120);
    expect(keepPointerInRect(490, rect)).toBe(490);
  });

  it("drops the last known coordinate once it is outside the container", () => {
    expect(keepPointerInRect(99, rect)).toBeNull();
    expect(keepPointerInRect(501, rect)).toBeNull();
  });

  it("keeps nothing to scroll when the coordinate is already unknown", () => {
    expect(keepPointerInRect(null, rect)).toBeNull();
  });
});
