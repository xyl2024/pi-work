import { describe, expect, it } from "vitest";
import {
  isStagedShape,
  saveTierForShape,
  type SettingsInputShape,
  type SettingsSaveTier,
} from "@/lib/shared/settings-save-semantics";

const EXPECTED: Array<[SettingsInputShape, SettingsSaveTier]> = [
  ["text", "staged"],
  ["secret", "staged"],
  ["textarea", "staged"],
  ["toggle", "immediate"],
  ["select", "immediate"],
  ["radio", "immediate"],
  ["checkbox", "immediate"],
  ["number", "immediate"],
  ["file", "immediate"],
];

describe("saveTierForShape", () => {
  it.each(EXPECTED)("%s ⇒ %s", (shape, tier) => {
    expect(saveTierForShape(shape)).toBe(tier);
  });
});

describe("isStagedShape", () => {
  it("is true exactly for the staged shapes", () => {
    for (const [shape, tier] of EXPECTED) {
      expect(isStagedShape(shape), shape).toBe(tier === "staged");
    }
  });

  it("keeps a free-text and an immediate control in the same section both correct", () => {
    expect(saveTierForShape("text")).toBe("staged");
    expect(saveTierForShape("checkbox")).toBe("immediate");
  });
});