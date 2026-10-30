export type SkillsPage =
  | { kind: "root" }
  | { kind: "detail"; filePath: string }
  | { kind: "add" };

export const SKILLS_ROOT_PAGE: SkillsPage = { kind: "root" };

export function createSkillsPageStack(): SkillsPage[] {
  return [SKILLS_ROOT_PAGE];
}

export function currentSkillsPage(pages: readonly SkillsPage[]): SkillsPage {
  return pages.length > 0 ? pages[pages.length - 1] : SKILLS_ROOT_PAGE;
}

export function openSkillsPage(page: SkillsPage): SkillsPage[] {
  if (page.kind === "root") return createSkillsPageStack();
  return [SKILLS_ROOT_PAGE, page];
}

export function backSkillsPage(pages: readonly SkillsPage[]): SkillsPage[] {
  if (pages.length <= 1) return createSkillsPageStack();
  return pages.slice(0, -1);
}

export function isSkillsRootPage(pages: readonly SkillsPage[]): boolean {
  return pages.length <= 1;
}
