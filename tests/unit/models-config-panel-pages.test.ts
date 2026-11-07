import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client/models-config-io", () => ({
  fetchApiKeyProviders: vi.fn(async () => []),
  fetchOAuthProviders: vi.fn(async () => []),
  fetchModelsConfigPayload: vi.fn(async () => ({ providers: {} })),
  putModelsConfig: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/client/oauth-login-store", () => ({
  hasActiveOAuthLogin: () => false,
  cancelActiveOAuthLogins: () => {},
  subscribeOAuthLogins: () => () => {},
  getOAuthLoginState: () => ({ phase: "idle" }),
}));

import {
  addModelsConfigCustomProvider,
  clearModelsConfigProvider,
  fillModelsConfigModelFromCatalog,
  modelsConfigPanel,
  openModelsConfigAddModelName,
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigCatalog,
  openModelsConfigFillModel,
  openModelsConfigModel,
  openModelsConfigOAuth,
  selectModelsConfigProvider,
  setModelsConfigProviderFilter,
} from "@/lib/client/models-config-panel";

const root = { kind: "root" } as const;

beforeEach(() => {
  modelsConfigPanel.release();
});

describe("models config page stacks", () => {
  it("keeps the browse page underneath every form", () => {
    openModelsConfigModel("openai", 2);
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "model", providerName: "openai", index: 2 },
    ]);

    openModelsConfigAddModelName("anthropic");
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "addModelName", providerName: "anthropic" },
    ]);

    openModelsConfigFillModel("openai", 1);
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "fillModel", providerName: "openai", index: 1 },
    ]);
  });

  it("replaces the form in place when moving between forms", () => {
    openModelsConfigAddProvider();
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "addProvider" }]);

    openModelsConfigOAuth("openai");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "oauth", providerId: "openai" }]);

    openModelsConfigApiKey("openai");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "apikey", providerId: "openai" }]);

    openModelsConfigCatalog();
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "catalog" }]);
  });

  it("returns from a catalog fill to the model form instead of stacking a third level", () => {
    openModelsConfigFillModel("openai", 1);

    fillModelsConfigModelFromCatalog("openai", 1, {
      id: "gpt-x",
      name: "GPT X",
      provider: "openai",
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      input: [],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    });

    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "model", providerName: "openai", index: 1 },
    ]);
  });
});

describe("adding a custom provider", () => {
  it("writes the default api into the draft before the form opens", () => {
    addModelsConfigCustomProvider();

    const state = modelsConfigPanel.get();
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "provider", name: "new-provider" }]);
    expect(state.config.providers?.["new-provider"]).toEqual({ api: "openai-completions" });
  });
});

describe("models config browse state", () => {
  it("treats the selected provider as view state, not as a page", () => {
    selectModelsConfigProvider("openai");

    expect(modelsConfigPanel.pages()).toEqual([root]);
    expect(modelsConfigPanel.get().selected).toEqual({ name: "openai", kind: "custom" });

    selectModelsConfigProvider("anthropic");
    expect(modelsConfigPanel.pages()).toEqual([root]);
    expect(modelsConfigPanel.get().selected).toEqual({ name: "anthropic", kind: "custom" });
  });

  it("keeps the provider filter when the selection moves", () => {
    setModelsConfigProviderFilter("endpoint");
    selectModelsConfigProvider("my-endpoint");
    selectModelsConfigProvider("openai");

    expect(modelsConfigPanel.get().providerFilter).toBe("endpoint");
  });

  it("clears the selection without touching the filter", () => {
    setModelsConfigProviderFilter("open");
    selectModelsConfigProvider("openai");

    clearModelsConfigProvider();

    expect(modelsConfigPanel.get().selected).toBeNull();
    expect(modelsConfigPanel.get().providerFilter).toBe("open");
  });

  it("remembers the source kind of the selected provider", () => {
    selectModelsConfigProvider("openai", "subscription");
    expect(modelsConfigPanel.get().selected).toEqual({ name: "openai", kind: "subscription" });

    selectModelsConfigProvider("anthropic", "apiKey");
    expect(modelsConfigPanel.get().selected).toEqual({ name: "anthropic", kind: "apiKey" });

    selectModelsConfigProvider("my-endpoint");
    expect(modelsConfigPanel.get().selected).toEqual({ name: "my-endpoint", kind: "custom" });
  });

  it("selects the provider when its auth page is opened", () => {
    openModelsConfigOAuth("openai");
    expect(modelsConfigPanel.get()).toMatchObject({
      selected: { name: "openai", kind: "subscription" },
    });

    openModelsConfigApiKey("anthropic");
    expect(modelsConfigPanel.get()).toMatchObject({
      selected: { name: "anthropic", kind: "apiKey" },
    });
  });
});
