import { describe, expect, it } from "vitest";
import {
  MODELS_CONFIG_ROOT_PAGE,
  backModelsConfigPage,
  createModelsConfigPageStack,
  currentModelsConfigPage,
  isModelsConfigRootPage,
  openModelsConfigPage,
  renameModelsConfigProviderPage,
  type ModelsConfigPage,
} from "@/lib/shared/models-config-pages";

/**
 * The models-config panel page stack (lib/shared/models-config-pages.ts).
 * Driven as plain data: push a detail page, back out, and keep the stack from
 * growing or underflowing — no DOM, no React.
 */

function provider(name: string): ModelsConfigPage {
  return { kind: "provider", name };
}

function model(providerName: string, index: number): ModelsConfigPage {
  return { kind: "model", providerName, index };
}

function addProvider(): ModelsConfigPage {
  return { kind: "addProvider" };
}

function addModelName(providerName: string): ModelsConfigPage {
  return { kind: "addModelName", providerName };
}

function fillModel(providerName: string, index: number): ModelsConfigPage {
  return { kind: "fillModel", providerName, index };
}

function catalog(): ModelsConfigPage {
  return { kind: "catalog" };
}

describe("createModelsConfigPageStack", () => {
  it("starts on the provider list", () => {
    expect(createModelsConfigPageStack()).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });
});

describe("currentModelsConfigPage", () => {
  it("renders the top of the stack", () => {
    expect(currentModelsConfigPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")])).toEqual(
      provider("openai"),
    );
  });

  it("falls back to the list for an empty stack", () => {
    expect(currentModelsConfigPage([])).toEqual(MODELS_CONFIG_ROOT_PAGE);
  });
});

describe("openModelsConfigPage", () => {
  it("opens a provider above the list", () => {
    expect(openModelsConfigPage(provider("openai"))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
    ]);
  });

  it("opens a model above its provider page", () => {
    expect(openModelsConfigPage(model("openai", 1))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
      model("openai", 1),
    ]);
  });

  it("replaces a sibling detail page instead of growing the stack", () => {
    const first = openModelsConfigPage(provider("openai"));
    const second = openModelsConfigPage(provider("anthropic"));

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second).toEqual([MODELS_CONFIG_ROOT_PAGE, provider("anthropic")]);
  });

  it("keeps the provider page under the model page", () => {
    expect(openModelsConfigPage(model("openai", 0))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
      model("openai", 0),
    ]);
  });

  it("returns to the list when opening the root page", () => {
    expect(openModelsConfigPage(MODELS_CONFIG_ROOT_PAGE)).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });

  it("opens the add-provider picker above the list", () => {
    expect(openModelsConfigPage(addProvider())).toEqual([MODELS_CONFIG_ROOT_PAGE, addProvider()]);
  });

  it("opens a subscription / API-key detail above the list", () => {
    expect(openModelsConfigPage({ kind: "oauth", providerId: "anthropic" })).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      { kind: "oauth", providerId: "anthropic" },
    ]);
    expect(openModelsConfigPage({ kind: "apikey", providerId: "openrouter" })).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      { kind: "apikey", providerId: "openrouter" },
    ]);
  });

  it("opens the model catalog as a root-level sibling of the list", () => {
    expect(openModelsConfigPage(catalog())).toEqual([MODELS_CONFIG_ROOT_PAGE, catalog()]);
  });

  it("keeps the provider page under the name-search page", () => {
    expect(openModelsConfigPage(addModelName("openai"))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
      addModelName("openai"),
    ]);
  });

  it("keeps the model page under the fill-from-catalog page", () => {
    expect(openModelsConfigPage(fillModel("openai", 2))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
      model("openai", 2),
      fillModel("openai", 2),
    ]);
  });
});

describe("backModelsConfigPage", () => {
  it("returns to the list from a detail page", () => {
    expect(backModelsConfigPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")])).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
    ]);
  });

  it("returns to the list from the model catalog", () => {
    expect(backModelsConfigPage([MODELS_CONFIG_ROOT_PAGE, catalog()])).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
    ]);
  });

  it("returns to the provider page from a model page", () => {
    const stack = openModelsConfigPage(model("openai", 1));
    expect(backModelsConfigPage(stack)).toEqual([MODELS_CONFIG_ROOT_PAGE, provider("openai")]);
  });

  it("stays on the list when already there", () => {
    expect(backModelsConfigPage([MODELS_CONFIG_ROOT_PAGE])).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });

  it("never lets the stack empty out", () => {
    expect(backModelsConfigPage([])).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });

  it("returns to the provider page from an add-model page", () => {
    const stack = openModelsConfigPage(addModelName("openai"));
    expect(backModelsConfigPage(stack)).toEqual([MODELS_CONFIG_ROOT_PAGE, provider("openai")]);
  });

  it("returns to the model page from a fill-from-catalog page", () => {
    const stack = openModelsConfigPage(fillModel("openai", 1));
    expect(backModelsConfigPage(stack)).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("openai"),
      model("openai", 1),
    ]);
  });
});

describe("isModelsConfigRootPage", () => {
  it("is true only while the list is on top", () => {
    expect(isModelsConfigRootPage(createModelsConfigPageStack())).toBe(true);
    expect(isModelsConfigRootPage([])).toBe(true);
    expect(isModelsConfigRootPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")])).toBe(false);
  });
});

describe("renameModelsConfigProviderPage", () => {
  it("moves the open detail page to the new name", () => {
    expect(
      renameModelsConfigProviderPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")], "openai", "oa"),
    ).toEqual([MODELS_CONFIG_ROOT_PAGE, provider("oa")]);
  });

  it("follows a rename when a model page is open", () => {
    const stack = openModelsConfigPage(model("openai", 2));
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("oa"),
      model("oa", 2),
    ]);
  });

  it("follows a rename when the name-search page is open", () => {
    const stack = openModelsConfigPage(addModelName("openai"));
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("oa"),
      addModelName("oa"),
    ]);
  });

  it("follows a rename when the fill-from-catalog page is open", () => {
    const stack = openModelsConfigPage(fillModel("openai", 3));
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      provider("oa"),
      model("oa", 3),
      fillModel("oa", 3),
    ]);
  });

  it("leaves an unrelated detail page alone", () => {
    const stack = [MODELS_CONFIG_ROOT_PAGE, provider("anthropic")];
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual(stack);
  });

  it("leaves a model page of another provider alone", () => {
    const stack = openModelsConfigPage(model("anthropic", 0));
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual(stack);
  });

  it("is a no-op on the list", () => {
    expect(renameModelsConfigProviderPage([MODELS_CONFIG_ROOT_PAGE], "openai", "oa")).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
    ]);
  });

  it("leaves the model catalog alone", () => {
    const stack = [MODELS_CONFIG_ROOT_PAGE, catalog()];
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual(stack);
  });
});
