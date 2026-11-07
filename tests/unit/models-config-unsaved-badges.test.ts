import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() }));

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
  renameModelsConfigProvider,
  revertModelsConfigDraft,
  selectModelsConfigChangeCount,
  selectModelsConfigChangedProviderNames,
  updateModelsConfigProvider,
} from "@/lib/client/models-config-panel";
import type { ModelsJson } from "@/lib/shared/models-config";

const baseline: ModelsJson = {
  providers: {
    alpha: { api: "openai-completions", models: [{ id: "a-1" }] },
    beta: { api: "anthropic", models: [{ id: "b-1" }] },
  },
};

function seed(): void {
  modelsConfigPanel.patch({ config: baseline, baseline, providerNames: {}, rawEdit: null });
}

beforeEach(() => {
  modelsConfigPanel.release();
  seed();
});

describe("selectModelsConfigChangedProviderNames", () => {
  it("is empty while the draft equals the baseline", () => {
    expect(selectModelsConfigChangedProviderNames(modelsConfigPanel.get())).toEqual([]);
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(0);
  });

  it("names only the providers whose draft differs from the baseline", () => {
    updateModelsConfigProvider("beta", { api: "anthropic", models: [{ id: "b-1", name: "Beta One" }] });

    expect(selectModelsConfigChangedProviderNames(modelsConfigPanel.get())).toEqual(["beta"]);
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("counts a renamed provider once even when its draft also changed", () => {
    renameModelsConfigProvider("alpha", "aardvark");
    updateModelsConfigProvider("alpha", { api: "openai-completions", models: [{ id: "a-1", reasoning: true }] });

    expect(selectModelsConfigChangedProviderNames(modelsConfigPanel.get())).toEqual(["alpha"]);
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("keeps the changed and renamed providers side by side", () => {
    renameModelsConfigProvider("alpha", "aardvark");
    updateModelsConfigProvider("beta", { api: "anthropic", models: [{ id: "b-1", maxTokens: 512 }] });

    expect(selectModelsConfigChangedProviderNames(modelsConfigPanel.get()).sort()).toEqual(["alpha", "beta"]);
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(2);
  });

  it("drops back to empty when the draft is reverted", () => {
    updateModelsConfigProvider("beta", { api: "anthropic", models: [{ id: "b-1", name: "Typed" }] });
    revertModelsConfigDraft();

    expect(selectModelsConfigChangedProviderNames(modelsConfigPanel.get())).toEqual([]);
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(0);
  });
});
