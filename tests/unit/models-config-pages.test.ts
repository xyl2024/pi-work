import { describe, expect, it } from "vitest";
import {
  MODELS_CONFIG_ROOT_PAGE,
  backModelsConfigPage,
  createModelsConfigPageStack,
  currentModelsConfigPage,
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

  it("opens a model above the list", () => {
    expect(openModelsConfigPage(model("openai", 1))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
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

  it("replaces a provider page with a model page (both are first-level details)", () => {
    expect(openModelsConfigPage(model("openai", 0))).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
      model("openai", 0),
    ]);
  });

  it("returns to the list when opening the root page", () => {
    expect(openModelsConfigPage(MODELS_CONFIG_ROOT_PAGE)).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });
});

describe("backModelsConfigPage", () => {
  it("returns to the list from a detail page", () => {
    expect(backModelsConfigPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")])).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
    ]);
  });

  it("stays on the list when already there", () => {
    expect(backModelsConfigPage([MODELS_CONFIG_ROOT_PAGE])).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });

  it("never lets the stack empty out", () => {
    expect(backModelsConfigPage([])).toEqual([MODELS_CONFIG_ROOT_PAGE]);
  });
});

describe("renameModelsConfigProviderPage", () => {
  it("moves the open detail page to the new name", () => {
    expect(
      renameModelsConfigProviderPage([MODELS_CONFIG_ROOT_PAGE, provider("openai")], "openai", "oa"),
    ).toEqual([MODELS_CONFIG_ROOT_PAGE, provider("oa")]);
  });

  it("follows a rename when a model page is open", () => {
    expect(
      renameModelsConfigProviderPage([MODELS_CONFIG_ROOT_PAGE, model("openai", 2)], "openai", "oa"),
    ).toEqual([MODELS_CONFIG_ROOT_PAGE, model("oa", 2)]);
  });

  it("leaves an unrelated detail page alone", () => {
    const stack = [MODELS_CONFIG_ROOT_PAGE, provider("anthropic")];
    expect(renameModelsConfigProviderPage(stack, "openai", "oa")).toEqual(stack);
  });

  it("is a no-op on the list", () => {
    expect(renameModelsConfigProviderPage([MODELS_CONFIG_ROOT_PAGE], "openai", "oa")).toEqual([
      MODELS_CONFIG_ROOT_PAGE,
    ]);
  });
});
