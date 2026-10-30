import { describe, expect, it } from "vitest";
import { clampIndex, wrapIndex, wrapPage } from "@/lib/client/composer/menu";

describe("composer menu navigation", () => {
  it("wraps the active index in both directions", () => {
    expect(wrapIndex(0, 3, 1)).toBe(1);
    expect(wrapIndex(2, 3, 1)).toBe(0);
    expect(wrapIndex(0, 3, -1)).toBe(2);
    expect(wrapIndex(1, 3, -1)).toBe(0);
  });

  it("has no active index without entries", () => {
    expect(wrapIndex(0, 0, 1)).toBe(0);
    expect(wrapIndex(4, 0, -1)).toBe(0);
  });

  it("wraps pages in both directions", () => {
    expect(wrapPage(0, 3, 1)).toBe(1);
    expect(wrapPage(2, 3, 1)).toBe(0);
    expect(wrapPage(0, 3, -1)).toBe(2);
    expect(wrapPage(0, 1, 1)).toBe(0);
  });

  it("clamps the active index into range", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(0);
  });
});
