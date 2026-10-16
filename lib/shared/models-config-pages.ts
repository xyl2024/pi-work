/**
 * Page stack for the models-config panel view.
 *
 * The panel navigates in levels instead of squeezing a two-column layout into
 * a narrow strip. There are at most four levels:
 *
 *   0. root — the provider list;
 *   1. a provider-level detail page — provider / OAuth / API key, or the
 *      read-only model catalog ("模型目录 / All model data", a root-level
 *      sibling);
 *   2. a model detail page — nested under its provider's page, so Back returns
 *      to the provider the model belongs to instead of jumping to the list;
 *   3. an add page — the add-provider three-way picker (above the list), the
 *      "name a model" catalog search (above its provider page), or the "fill
 *      this model from the catalog" picker (above its model page).
 *
 * Every page carries the context it needs (a provider name, a model index, a
 * runtime provider id) so a tab switch that remounts the view can rebuild the
 * same page. This module owns the stack rules so they can be driven from
 * `tests/unit` without a browser — `lib/client/models-config-store.ts` holds
 * the current stack and the panel renders `currentModelsConfigPage`.
 *
 * Two rules matter here:
 *
 *   • the stack is bounded — opening any page replaces whatever sits at or
 *     above the page's own level, so provider → provider, or provider → model
 *     → fill model, never grows the stack past the level it opened;
 *   • the root page is never popped — `backModelsConfigPage` stops there and
 *     an empty stack still resolves to root.
 */

/** One level of the panel's navigation. */
export type ModelsConfigPage =
  | { kind: "root" }
  | { kind: "provider"; name: string }
  | { kind: "model"; providerName: string; index: number }
  | { kind: "oauth"; providerId: string }
  | { kind: "apikey"; providerId: string }
  | { kind: "catalog" }
  | { kind: "addProvider" }
  | { kind: "addModelName"; providerName: string }
  | { kind: "fillModel"; providerName: string; index: number };

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
 * The stack a page opens onto. A provider-level detail replaces any other
 * provider-level detail (so provider → OAuth is a two-page stack), while a
 * nested page keeps the pages it hangs off so `back` is always "up one level".
 */
function baseStackFor(page: ModelsConfigPage): ModelsConfigPage[] {
  switch (page.kind) {
    case "root":
      return [];
    // A model belongs to a provider, so its page sits above the provider page
    // (and the add-model / fill-model pages above the model page). Back from a
    // model therefore lands on the provider, not on the provider list.
    case "model":
      return [MODELS_CONFIG_ROOT_PAGE, { kind: "provider", name: page.providerName }];
    case "addModelName":
      return [MODELS_CONFIG_ROOT_PAGE, { kind: "provider", name: page.providerName }];
    case "fillModel":
      return [
        MODELS_CONFIG_ROOT_PAGE,
        { kind: "provider", name: page.providerName },
        { kind: "model", providerName: page.providerName, index: page.index },
      ];
    // Every other page is a provider-level detail or (like the add-provider
    // picker) a page reached straight from the list. The catalog is a
    // root-level sibling: it opens straight above the list and Back returns
    // there, which is what keeps it inside this panel view rather than a second
    // panel / a second button.
    case "provider":
    case "oauth":
    case "apikey":
    case "catalog":
    case "addProvider":
      return [MODELS_CONFIG_ROOT_PAGE];
    default:
      return assertNever(page);
  }
}

/** Compile-time exhaustiveness guard for the page union. */
function assertNever(page: never): never {
  throw new Error(`unhandled models-config page: ${JSON.stringify(page)}`);
}

/**
 * Enter a page. Anything at or above the page's own level is replaced, so
 * sibling navigation (provider A → provider B, or adding a second model) cannot
 * grow the stack.
 */
export function openModelsConfigPage(page: ModelsConfigPage): ModelsConfigPage[] {
  if (page.kind === "root") return createModelsConfigPageStack();
  return [...baseStackFor(page), page];
}

/** Pop one level. The provider list is a floor: backing off it is a no-op. */
export function backModelsConfigPage(pages: readonly ModelsConfigPage[]): ModelsConfigPage[] {
  if (pages.length <= 1) return createModelsConfigPageStack();
  return pages.slice(0, -1);
}

/**
 * Whether the stack is sitting on the root page, i.e. an Escape cannot pop a
 * level and the panel is free to run its tab-close rules instead.
 */
export function isModelsConfigRootPage(pages: readonly ModelsConfigPage[]): boolean {
  return pages.length <= 1;
}

/**
 * Follow a provider rename so an open provider / model / add page keeps
 * showing the entity it was opened for.
 */
export function renameModelsConfigProviderPage(
  pages: readonly ModelsConfigPage[],
  oldName: string,
  newName: string,
): ModelsConfigPage[] {
  return pages.map((page) => {
    if (page.kind === "provider" && page.name === oldName) return { kind: "provider", name: newName };
    if (page.kind === "model" && page.providerName === oldName) return { ...page, providerName: newName };
    if (page.kind === "addModelName" && page.providerName === oldName) return { ...page, providerName: newName };
    if (page.kind === "fillModel" && page.providerName === oldName) return { ...page, providerName: newName };
    return page;
  });
}
