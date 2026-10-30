import { describe, expect, it } from "vitest";
import {
  SKILLS_ROOT_PAGE,
  backSkillsPage,
  createSkillsPageStack,
  currentSkillsPage,
  isSkillsRootPage,
  openSkillsPage,
  type SkillsPage,
} from "@/lib/shared/skills-pages";

function detail(filePath: string): SkillsPage {
  return { kind: "detail", filePath };
}

function add(): SkillsPage {
  return { kind: "add" };
}

describe("createSkillsPageStack", () => {
  it("starts on the grouped grid", () => {
    expect(createSkillsPageStack()).toEqual([SKILLS_ROOT_PAGE]);
  });
});

describe("currentSkillsPage", () => {
  it("renders the top of the stack", () => {
    expect(currentSkillsPage([SKILLS_ROOT_PAGE, detail("/a/SKILL.md")])).toEqual(
      detail("/a/SKILL.md"),
    );
  });

  it("falls back to the grid for an empty stack", () => {
    expect(currentSkillsPage([])).toEqual(SKILLS_ROOT_PAGE);
  });
});

describe("openSkillsPage", () => {
  it("opens a detail page above the grid", () => {
    expect(openSkillsPage(detail("/a/SKILL.md"))).toEqual([SKILLS_ROOT_PAGE, detail("/a/SKILL.md")]);
  });

  it("opens the add page above the grid", () => {
    expect(openSkillsPage(add())).toEqual([SKILLS_ROOT_PAGE, add()]);
  });

  it("replaces one skill's detail page with another's instead of growing the stack", () => {
    const first = openSkillsPage(detail("/a/SKILL.md"));
    const second = openSkillsPage(detail("/b/SKILL.md"));

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second).toEqual([SKILLS_ROOT_PAGE, detail("/b/SKILL.md")]);
  });

  it("replaces an open detail page when entering the add page", () => {
    const stack = openSkillsPage(detail("/a/SKILL.md"));
    expect(openSkillsPage(add())).toEqual([SKILLS_ROOT_PAGE, add()]);
    expect(stack).toHaveLength(2);
  });

  it("replaces the add page when entering a detail page", () => {
    const stack = openSkillsPage(add());
    expect(openSkillsPage(detail("/a/SKILL.md"))).toEqual([
      SKILLS_ROOT_PAGE,
      detail("/a/SKILL.md"),
    ]);
    expect(stack).toHaveLength(2);
  });

  it("returns to the grid when opening the root page", () => {
    expect(openSkillsPage(SKILLS_ROOT_PAGE)).toEqual([SKILLS_ROOT_PAGE]);
  });
});

describe("backSkillsPage", () => {
  it("returns to the grid from a detail page", () => {
    expect(backSkillsPage([SKILLS_ROOT_PAGE, detail("/a/SKILL.md")])).toEqual([SKILLS_ROOT_PAGE]);
  });

  it("returns to the grid from the add page", () => {
    expect(backSkillsPage([SKILLS_ROOT_PAGE, add()])).toEqual([SKILLS_ROOT_PAGE]);
  });

  it("stays on the grid when already there", () => {
    expect(backSkillsPage([SKILLS_ROOT_PAGE])).toEqual([SKILLS_ROOT_PAGE]);
  });

  it("never lets the stack empty out", () => {
    expect(backSkillsPage([])).toEqual([SKILLS_ROOT_PAGE]);
  });
});

describe("isSkillsRootPage", () => {
  it("is true only while the grid is on top", () => {
    expect(isSkillsRootPage(createSkillsPageStack())).toBe(true);
    expect(isSkillsRootPage([])).toBe(true);
    expect(isSkillsRootPage([SKILLS_ROOT_PAGE, detail("/a/SKILL.md")])).toBe(false);
    expect(isSkillsRootPage([SKILLS_ROOT_PAGE, add()])).toBe(false);
  });
});
