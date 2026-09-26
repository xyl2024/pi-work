import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sectionsDir = path.join(repoRoot, "components/settings/sections");

/** Every .tsx under components/settings/sections, with its source. */
function sectionSources(): Array<{ file: string; source: string }> {
  return readdirSync(sectionsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({
      file: `components/settings/sections/${name}`,
      source: readFileSync(path.join(sectionsDir, name), "utf8"),
    }));
}

/** Every .ts/.tsx under components/settings, recursively. */
function allSettingsSources(): Array<{ file: string; source: string }> {
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

/** Strip // line comments and /* block comments so prose is not scanned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * Skin properties a section must not put on a form control inline: they come
 * from the shared control module. Layout properties (display / flex / gap /
 * margin / width…) remain allowed inline.
 */
const SKIN_PROP = /border|background/i;

/** Inline `style={{ … }}` object literals attached to a JSX tag. */
function inlineStyleObjects(tag: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  while (true) {
    const start = tag.indexOf("style={{", cursor);
    if (start === -1) break;
    const end = tag.indexOf("}}", start + "style={{".length);
    if (end === -1) break;
    out.push(tag.slice(start, end + 2));
    cursor = end + 2;
  }
  return out;
}

/**
 * ADR-0003 rule 3 forbids a browser test rig, so the "one control skin" rule
 * is pinned by a source guard: a section file may not style a form control
 * (input / textarea / select / button) with inline border / background
 * literals. This is an approximation that exists to stop regressions, not a
 * proof — layouts and non-control elements are unaffected.
 */
describe("settings sections use the shared control skin", () => {
  it("has no inline skin on a form control", () => {
    const offenders: string[] = [];
    for (const { file, source } of sectionSources()) {
      const code = stripComments(source);
      for (const match of code.matchAll(/<(input|textarea|select|button)\b[\s\S]*?>/g)) {
        const tag = match[0];
        for (const style of inlineStyleObjects(tag)) {
          if (SKIN_PROP.test(style)) {
            offenders.push(`${file}: ${tag.slice(0, 60)}…`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not keep a local copy of a control skin or control component", () => {
    const offenders: string[] = [];
    for (const { file, source } of allSettingsSources()) {
      // The shared control module is the one place these may be defined.
      if (file.endsWith("components/settings/controls.tsx")) continue;
      const code = stripComments(source);
      for (const pattern of [
        /(?:function|const)\s+inputStyle\b/,
        /(?:function|const)\s+selectStyle\b/,
        /(?:function|const)\s+PrimaryButton\b/,
        /(?:function|const)\s+SecondaryButton\b/,
        /(?:function|const)\s+DangerButton\b/,
      ]) {
        if (pattern.test(code)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("models-config shares the one control definition", () => {
  it("re-exports the settings controls instead of defining its own", () => {
    const shim = readFileSync(
      path.join(repoRoot, "components/settings/models-config/form-fields.tsx"),
      "utf8",
    );
    expect(shim).toContain('export * from "../controls"');
    expect(shim).not.toMatch(/borderRadius:\s*5/);
  });
});