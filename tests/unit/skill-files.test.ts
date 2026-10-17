import { describe, expect, it } from "vitest";
import {
  fileLanguage,
  groupSkillFiles,
  stripFrontmatter,
} from "@/lib/shared/skill-files";
import type { SkillDetailFile } from "@/lib/shared/skills";

/**
 * The pure attached-file helpers (lib/shared/skill-files.ts) shared by the
 * panel detail page and the retiring modal: frontmatter stripping, language
 * detection and the manifest grouping rule.
 */

function file(relativePath: string, opts: Partial<SkillDetailFile> = {}): SkillDetailFile {
  const name = relativePath.split("/").pop() ?? relativePath;
  return {
    name,
    path: `/skills/demo/${relativePath}`,
    relativePath,
    size: 10,
    isText: true,
    isDirectory: false,
    ...opts,
  };
}

function dir(relativePath: string): SkillDetailFile {
  return {
    name: relativePath.split("/").pop() ?? relativePath,
    path: `/skills/demo/${relativePath}`,
    relativePath,
    size: 0,
    isText: false,
    isDirectory: true,
  };
}

describe("stripFrontmatter", () => {
  it("drops a leading YAML block and keeps the body", () => {
    expect(stripFrontmatter("---\nname: demo\n---\n# Title\n\nBody")).toBe("# Title\n\nBody");
  });

  it("handles CRLF frontmatter", () => {
    expect(stripFrontmatter("---\r\nname: demo\r\n---\r\nBody")).toBe("Body");
  });

  it("leaves a document without frontmatter untouched", () => {
    expect(stripFrontmatter("# Title\n\nBody")).toBe("# Title\n\nBody");
  });

  it("does not strip a horizontal rule in the middle of a document", () => {
    expect(stripFrontmatter("# Title\n\n---\n\nBody")).toBe("# Title\n\n---\n\nBody");
  });
});

describe("fileLanguage", () => {
  it("maps known extensions", () => {
    expect(fileLanguage("process.sh")).toBe("bash");
    expect(fileLanguage("config.yaml")).toBe("yaml");
    expect(fileLanguage("SKILL.md")).toBe("markdown");
  });

  it("handles extensionless well-known filenames", () => {
    expect(fileLanguage("Dockerfile")).toBe("dockerfile");
    expect(fileLanguage("Makefile")).toBe("makefile");
    expect(fileLanguage(".env")).toBe("bash");
  });

  it("falls back to plain text", () => {
    expect(fileLanguage("LICENSE")).toBe("text");
    expect(fileLanguage("weird.zzz")).toBe("text");
  });
});

describe("groupSkillFiles", () => {
  it("returns no groups for an empty manifest", () => {
    expect(groupSkillFiles([])).toEqual([]);
  });

  it("pins SKILL.md first", () => {
    const groups = groupSkillFiles([dir("scripts"), file("scripts/run.sh"), file("SKILL.md")]);
    expect(groups.map((group) => group.key)).toEqual(["__skillmd", "scripts"]);
    expect(groups[0]).toEqual({ key: "__skillmd", label: "SKILL.md", files: [file("SKILL.md")] });
  });

  it("orders known directories scripts → references → assets, then others alphabetically", () => {
    const groups = groupSkillFiles([
      dir("zeta"),
      dir("assets"),
      dir("references"),
      dir("scripts"),
      file("zeta/z.txt"),
      file("assets/logo.svg"),
      file("references/api.md"),
      file("scripts/run.sh"),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "scripts",
      "references",
      "assets",
      "zeta",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Scripts",
      "References",
      "Assets",
      "zeta",
    ]);
  });

  it("keeps deeper files with their top-level directory", () => {
    const groups = groupSkillFiles([dir("scripts"), file("scripts/lib/helper.py")]);
    expect(groups).toEqual([
      { key: "scripts", label: "Scripts", files: [file("scripts/lib/helper.py")] },
    ]);
  });

  it("sorts files within a group by name", () => {
    const groups = groupSkillFiles([
      dir("scripts"),
      file("scripts/z.sh"),
      file("scripts/a.sh"),
    ]);
    expect(groups[0].files.map((f) => f.name)).toEqual(["a.sh", "z.sh"]);
  });

  it("drops directories that have no files", () => {
    expect(groupSkillFiles([dir("empty")])).toEqual([]);
  });

  it("collects loose root files under Other files, last", () => {
    const groups = groupSkillFiles([
      file("README.md"),
      file("LICENSE"),
      dir("scripts"),
      file("scripts/run.sh"),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["scripts", "other"]);
    expect(groups[1]).toEqual({
      key: "other",
      label: "Other files",
      files: [file("LICENSE"), file("README.md")],
    });
  });
});
