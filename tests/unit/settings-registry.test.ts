import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  groupForSection,
  sectionsForGroup,
  type SettingsSectionId,
} from "@/components/settings/registry";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Every file under components/settings, recursively, with its source. */
function settingsSources(): Array<{ file: string; source: string }> {
  const root = path.join(repoRoot, "components/settings");
  const out: Array<{ file: string; source: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        out.push({ file: path.relative(repoRoot, full), source: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

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
 * Source guard: the set of sections the modal actually renders must equal the
 * registry. A new section wrapper that is added to the JSX but forgotten in
 * `registry.ts` (or vice versa) fails here instead of silently not appearing.
 */
describe("settings registry covers every rendered section", () => {
  const rendered = new Set<string>();
  for (const { source } of settingsSources()) {
    for (const match of source.matchAll(/SettingsSection\s+id="([a-z-]+)"/g)) {
      rendered.add(match[1]);
    }
  }

  it("finds a wrapper for every registry section", () => {
    for (const id of SETTINGS_SECTION_IDS) {
      expect(rendered.has(id), `no <SettingsSection id="${id}"> found`).toBe(true);
    }
  });

  it("registers every rendered wrapper", () => {
    const registered = new Set<string>(SETTINGS_SECTION_IDS as readonly SettingsSectionId[]);
    for (const id of rendered) {
      expect(registered.has(id), `rendered id "${id}" is not in the registry`).toBe(true);
    }
  });
});