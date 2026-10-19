import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  groupForSection,
  sectionsForGroup,
} from "@/components/settings/registry";
import { SETTINGS_PAGES } from "@/components/settings/pages";

describe("settings registry invariants", () => {
  it("has unique group and section ids", () => {
    const groups = SETTINGS_GROUPS.map((g) => g.id);
    const sections = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(groups).size).toBe(groups.length);
    expect(new Set(sections).size).toBe(sections.length);
  });

  it("gives every section an existing group", () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const section of SETTINGS_SECTIONS) {
      expect(groupIds.has(section.group), `section ${section.id} → group ${section.group}`).toBe(true);
      expect(groupForSection(section.id).id).toBe(section.group);
    }
  });

  it("leaves no group empty", () => {
    for (const group of SETTINGS_GROUPS) {
      expect(sectionsForGroup(group.id).length, `group ${group.id}`).toBeGreaterThan(0);
    }
  });

  it("makes the navigation order equal the render order", () => {
    const renderOrder = SETTINGS_GROUPS.flatMap((group) =>
      sectionsForGroup(group.id).map((section) => section.id),
    );
    expect([...SETTINGS_SECTION_IDS]).toEqual(renderOrder);
    // …and that flat order is exactly the declared section order.
    expect(renderOrder).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
  });

  it("marks exactly the developer group as secondary", () => {
    const developer = SETTINGS_GROUPS.filter((g) => g.developer).map((g) => g.id);
    expect(developer).toEqual(["developer"]);
  });
});

/**
 * Page map guard: every registry section has exactly one page, and the map
 * has no page for a section that is not in the registry.
 *
 * The map is typed `Record<SettingsSectionId, …>`, so the compiler already
 * rejects a missing or extra page; this test pins the keyset explicitly so the
 * invariant is visible here too.
 */
describe("settings page map covers exactly the registry", () => {
  it("keys the page map by the registry's section ids", () => {
    expect(Object.keys(SETTINGS_PAGES).sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
  });
});
