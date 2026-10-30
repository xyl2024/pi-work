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

export const MODELS_CONFIG_ROOT_PAGE: ModelsConfigPage = { kind: "root" };

export function createModelsConfigPageStack(): ModelsConfigPage[] {
  return [MODELS_CONFIG_ROOT_PAGE];
}

export function currentModelsConfigPage(pages: readonly ModelsConfigPage[]): ModelsConfigPage {
  return pages.length > 0 ? pages[pages.length - 1] : MODELS_CONFIG_ROOT_PAGE;
}

function baseStackFor(page: ModelsConfigPage): ModelsConfigPage[] {
  switch (page.kind) {
    case "root":
      return [];
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

function assertNever(page: never): never {
  throw new Error(`unhandled models-config page: ${JSON.stringify(page)}`);
}

export function openModelsConfigPage(page: ModelsConfigPage): ModelsConfigPage[] {
  if (page.kind === "root") return createModelsConfigPageStack();
  return [...baseStackFor(page), page];
}

export function backModelsConfigPage(pages: readonly ModelsConfigPage[]): ModelsConfigPage[] {
  if (pages.length <= 1) return createModelsConfigPageStack();
  return pages.slice(0, -1);
}

export function isModelsConfigRootPage(pages: readonly ModelsConfigPage[]): boolean {
  return pages.length <= 1;
}

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
