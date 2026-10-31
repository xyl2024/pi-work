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
  modelsConfigPanel,
  openModelsConfigAddModelName,
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigCatalog,
  openModelsConfigFillModel,
  openModelsConfigModel,
  openModelsConfigOAuth,
  openModelsConfigProvider,
} from "@/lib/client/models-config-panel";

const root = { kind: "root" } as const;

beforeEach(() => {
  modelsConfigPanel.release();
});

describe("models config page stacks", () => {
  it("opens a provider from any depth as root + provider", () => {
    openModelsConfigProvider("openai");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "provider", name: "openai" }]);

    openModelsConfigProvider("anthropic");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "provider", name: "anthropic" }]);
  });

  it("builds the root + provider base for a model and an added model name", () => {
    openModelsConfigProvider("openai");
    openModelsConfigModel("openai", 2);
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "provider", name: "openai" },
      { kind: "model", providerName: "openai", index: 2 },
    ]);

    openModelsConfigAddModelName("anthropic");
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "provider", name: "anthropic" },
      { kind: "addModelName", providerName: "anthropic" },
    ]);
  });

  it("builds the three-level base for the catalog fill page", () => {
    openModelsConfigModel("openai", 1);
    openModelsConfigFillModel("openai", 1);
    expect(modelsConfigPanel.pages()).toEqual([
      root,
      { kind: "provider", name: "openai" },
      { kind: "model", providerName: "openai", index: 1 },
      { kind: "fillModel", providerName: "openai", index: 1 },
    ]);
  });

  it("replaces the whole stack when leaving the add-provider page for an OAuth or API key page", () => {
    openModelsConfigAddProvider();
    openModelsConfigOAuth("openai");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "oauth", providerId: "openai" }]);

    openModelsConfigAddProvider();
    openModelsConfigApiKey("openai");
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "apikey", providerId: "openai" }]);

    openModelsConfigAddProvider();
    openModelsConfigCatalog();
    expect(modelsConfigPanel.pages()).toEqual([root, { kind: "catalog" }]);
  });
});
