import { describe, expect, it } from "vitest";
import {
  isStagedShape,
  saveTierForShape,
  type SettingsInputShape,
  type SettingsSaveTier,
} from "@/lib/shared/settings-save-semantics";

/**
 * The save tier is a lookup by input shape, not a per-section convention.
 * Table-driven like `auto-naming.test.ts`: every shape has exactly one
 * expected tier and the table is the contract.
 */
const EXPECTED: Array<[SettingsInputShape, SettingsSaveTier]> = [
  // Free text and secrets are staged — the user must be able to finish typing.
  ["text", "staged"],
  ["secret", "staged"],
  ["textarea", "staged"],
  // One-gesture controls apply immediately.
  ["toggle", "immediate"],
  ["select", "immediate"],
  ["radio", "immediate"],
  ["checkbox", "immediate"],
  // Blur / Enter commit is still "I am done".
  ["number", "immediate"],
  // File pick commits on selection.
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
    // Network proxy mixes a staged secret-ish URL with an immediate checkbox;
    // the table decides each one, the section does not.
    expect(saveTierForShape("text")).toBe("staged");
    expect(saveTierForShape("checkbox")).toBe("immediate");
  });
});