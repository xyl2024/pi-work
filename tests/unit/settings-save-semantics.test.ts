import { describe, expect, it } from "vitest";
import {
  isStagedShape,
  saveTierForShape,
  type SettingsInputShape,
  type SettingsSaveTier,
} from "@/lib/shared/settings-save-semantics";
import { SETTINGS_OWNED_KEYS } from "@/lib/shared/settings-keys";

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
/**
 * The write contract itself (ADR-0009): `PUT /api/settings` owns exactly this
 * key set, and the client writer derives its outbound patch from the same list.
 * Pinned here because the set is what makes a stale full-config snapshot
 * harmless.
 */
describe("SETTINGS_OWNED_KEYS", () => {
  it("owns the system prompt template and no longer the retired switches", () => {
    expect([...SETTINGS_OWNED_KEYS]).toContain("system_prompt_template");
    expect([...SETTINGS_OWNED_KEYS]).not.toContain("append_system");
    expect([...SETTINGS_OWNED_KEYS]).not.toContain("load_pi_docs");
  });

  it("is exactly the documented set", () => {
    expect([...SETTINGS_OWNED_KEYS].sort()).toEqual([
      "file_viewer",
      "network_proxy",
      "right_side_bar",
      "system_prompt_template",
      "ui_sounds",
      "web_access",
    ]);
  });
});
