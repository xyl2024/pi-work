import { describe, expect, it } from "vitest";
import {
  clampCanvasScale,
  computeZoomAnchor,
  DEFAULT_CANVAS_SCALE,
  fitCanvasScale,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  scrollForAnchor,
} from "@/lib/shared/canvasZoom";

describe("clampCanvasScale", () => {
  it("keeps in-range scales untouched", () => {
    expect(clampCanvasScale(1)).toBe(1);
    expect(clampCanvasScale(0.5)).toBe(0.5);
  });

  it("clamps out-of-range scales", () => {
    expect(clampCanvasScale(10)).toBe(MAX_CANVAS_SCALE);
    expect(clampCanvasScale(0.01)).toBe(MIN_CANVAS_SCALE);
    expect(clampCanvasScale(-2)).toBe(MIN_CANVAS_SCALE);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampCanvasScale(Number.NaN)).toBe(DEFAULT_CANVAS_SCALE);
    expect(clampCanvasScale(Number.POSITIVE_INFINITY)).toBe(MAX_CANVAS_SCALE);
  });
});

describe("computeZoomAnchor / scrollForAnchor", () => {
  it("anchors the pointer position to the same canvas point", () => {
    const anchor = computeZoomAnchor({
      currentScale: 1,
      scroll: { left: 0, top: 100 },
      viewport: { width: 400, height: 300 },
      pointer: { x: 50, y: 50 },
    });
    expect(anchor).toEqual({ contentX: 50, contentY: 150, mx: 50, my: 50 });

    expect(scrollForAnchor(anchor, 2)).toEqual({ left: 50, top: 250 });
  });

  it("centers when no pointer is given", () => {
    const anchor = computeZoomAnchor({
      currentScale: 0.5,
      scroll: { left: 0, top: 0 },
      viewport: { width: 800, height: 600 },
    });
    expect(anchor).toEqual({ contentX: 800, contentY: 600, mx: 400, my: 300 });
  });

  it("derives from the pending anchor while scroll is still stale", () => {
    const pending = { contentX: 200, contentY: 300, mx: 100, my: 100 };
    const anchor = computeZoomAnchor({
      currentScale: 2,
      scroll: { left: 0, top: 0 },
      viewport: { width: 400, height: 300 },
      pointer: { x: 110, y: 100 },
      pending,
    });
    expect(anchor.contentX).toBe(205);
    expect(anchor.contentY).toBe(300);
    expect(anchor.mx).toBe(110);
  });

  it("never returns negative scroll offsets", () => {
    const anchor = { contentX: 10, contentY: 10, mx: 200, my: 150 };
    expect(scrollForAnchor(anchor, 1)).toEqual({ left: 0, top: 0 });
  });
});

describe("fitCanvasScale", () => {
  it("fits the limiting axis and leaves the inset", () => {
    expect(fitCanvasScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBeCloseTo(
      (1000 - 24) / 2000,
    );
  });

  it("clamps into the zoom range", () => {
    expect(fitCanvasScale({ width: 100000, height: 100 }, { width: 300, height: 300 })).toBe(
      MIN_CANVAS_SCALE,
    );
  });

  it("falls back for a degenerate canvas", () => {
    expect(fitCanvasScale({ width: 0, height: 0 }, { width: 300, height: 300 })).toBe(
      DEFAULT_CANVAS_SCALE,
    );
  });
});
