/**
 * Page stack for the models-config panel view.
 *
 * The panel navigates in levels instead of squeezing a two-column layout into
 * a narrow strip: the root page (the provider list) sits at the bottom, and
 * every detail / add page is a full-width page above it. This module owns the
 * stack rules so they can be driven from `tests/unit` without a browser —
 * `lib/client/models-config-store.ts` holds the current stack and the panel
 * renders `currentModelsConfigPage`.
 *
 * Two rules matter here:
 *
 *   • the stack never grows forever — entering a detail page replaces
 *     anything above root, so going provider → provider → provider is always
 *     a two-page stack;
 *   • the root page is never popped — `backModelsConfigPage` stops there and
 *     an empty stack still resolves to root.
 *
 * The page union only carries what the panel can actually navigate to today.
 * Later slices add the model / OAuth / API-key / add pages to the union; the
 * stack rules above do not change.
 */

/** One level of the panel's navigation. */
export type ModelsConfigPage =
  | { kind: "root" }
  | { kind: "provider"; name: string };

/** The provider list — the bottom of every stack. */
export const MODELS_CONFIG_ROOT_PAGE: ModelsConfigPage = { kind: "root" };

/** A fresh stack, sitting on the provider list. */
export function createModelsConfigPageStack(): ModelsConfigPage[] {
  return [MODELS_CONFIG_ROOT_PAGE];
}

/** The page the panel renders: the top of the stack, root when it is empty. */
export function currentModelsConfigPage(pages: readonly ModelsConfigPage[]): ModelsConfigPage {
  return pages.length > 0 ? pages[pages.length - 1] : MODELS_CONFIG_ROOT_PAGE;
}

/**
 * Enter a page reached from the list. Anything above root is replaced, so
 * sibling navigation (provider A → provider B) cannot grow the stack.
 */
export function openModelsConfigPage(page: ModelsConfigPage): ModelsConfigPage[] {
  if (page.kind === "root") return createModelsConfigPageStack();
  return [MODELS_CONFIG_ROOT_PAGE, page];
}

/** Pop one level. The provider list is a floor: backing off it is a no-op. */
export function backModelsConfigPage(pages: readonly ModelsConfigPage[]): ModelsConfigPage[] {
  if (pages.length <= 1) return createModelsConfigPageStack();
  return pages.slice(0, -1);
}

/** Follow a provider rename so the open detail page keeps showing the entity. */
export function renameModelsConfigProviderPage(
  pages: readonly ModelsConfigPage[],
  oldName: string,
  newName: string,
): ModelsConfigPage[] {
  if (currentModelsConfigPage(pages).kind !== "provider") return [...pages];
  return pages.map((page) =>
    page.kind === "provider" && page.name === oldName ? { kind: "provider", name: newName } : page,
  );
}
