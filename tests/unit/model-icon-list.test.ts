import { describe, expect, it } from "vitest";
import {
  MODEL_ICON_LIST_COLLAPSE_THRESHOLD,
  shouldCollapseModelIconList,
} from "@/lib/shared/model-icon-list";

/** Collapse rule for a provider detail page's model list — plain data, no DOM. */

describe("shouldCollapseModelIconList", () => {
  it("keeps short lists fully expanded", () => {
    expect(shouldCollapseModelIconList(0)).toBe(false);
    expect(shouldCollapseModelIconList(1)).toBe(false);
    expect(shouldCollapseModelIconList(MODEL_ICON_LIST_COLLAPSE_THRESHOLD)).toBe(false);
  });

  it("collapses once the list grows past the threshold", () => {
    expect(shouldCollapseModelIconList(MODEL_ICON_LIST_COLLAPSE_THRESHOLD + 1)).toBe(true);
    expect(shouldCollapseModelIconList(40)).toBe(true);
  });

  it("treats nonsense counts as nothing to collapse", () => {
    expect(shouldCollapseModelIconList(-1)).toBe(false);
    expect(shouldCollapseModelIconList(Number.NaN)).toBe(false);
    expect(shouldCollapseModelIconList(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
