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

import { putModelsConfig } from "@/lib/client/models-config-io";
import {
  cancelModelsConfigDelete,
  confirmModelsConfigDelete,
  discardModelsConfigDraft,
  modelsConfigPanel,
  openModelsConfigModel,
  openModelsConfigProviderForm,
  requestModelsConfigModelDelete,
  requestModelsConfigProviderDelete,
  selectModelsConfigChangeCount,
  selectModelsConfigDeleteConfirm,
  selectModelsConfigDirty,
} from "@/lib/client/models-config-panel";
import type { ModelsJson } from "@/lib/shared/models-config";

const baseline: ModelsJson = {
  providers: {
    alpha: {
      api: "openai-completions",
      models: [{ id: "a-1", name: "Alpha One" }, { id: "a-2" }, { id: "a-3" }],
    },
    beta: { api: "openai-completions", models: [{ id: "b-1" }] },
  },
};

function seed(): void {
  modelsConfigPanel.patch({
    config: baseline,
    baseline,
    providerNames: {},
    rawEdit: null,
    selected: null,
    pendingDelete: null,
  });
}

beforeEach(() => {
  vi.mocked(putModelsConfig).mockClear();
  seed();
});

describe("deleting a provider waits for confirmation", () => {
  it("leaves the draft untouched while the request is pending", () => {
    openModelsConfigProviderForm("alpha");
    requestModelsConfigProviderDelete("alpha");
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toEqual({ kind: "provider", name: "alpha" });
    expect(state.config).toEqual(baseline);
    expect(selectModelsConfigDirty(state)).toBe(false);
    expect(selectModelsConfigChangeCount(state)).toBe(0);
    expect(putModelsConfig).not.toHaveBeenCalled();
  });

  it("quantifies the affected models in the prompt", () => {
    requestModelsConfigProviderDelete("alpha");
    const prompt = selectModelsConfigDeleteConfirm(modelsConfigPanel.get());
    expect(prompt?.titleKey).toBe("Delete provider");
    expect(prompt?.descriptionKey).toBe('Delete "{name}" and its {n} model definitions? This takes effect after saving.');
    expect(prompt?.params).toEqual({ name: "alpha", n: 3 });
    expect(prompt?.affectedModelCount).toBe(3);
  });

  it("uses the drafted provider name in the prompt", () => {
    modelsConfigPanel.patch({ providerNames: { alpha: "alpha-2" } });
    requestModelsConfigProviderDelete("alpha");
    expect(selectModelsConfigDeleteConfirm(modelsConfigPanel.get())?.params).toEqual({ name: "alpha-2", n: 3 });
  });

  it("keeps the page stack while the prompt is open", () => {
    openModelsConfigProviderForm("alpha");
    requestModelsConfigProviderDelete("alpha");
    expect(modelsConfigPanel.pageDepth()).toBe(2);
  });

  it("is lossless when cancelled", () => {
    openModelsConfigProviderForm("alpha");
    requestModelsConfigProviderDelete("alpha");
    cancelModelsConfigDelete();
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toBeNull();
    expect(state.config).toEqual(baseline);
    expect(selectModelsConfigDeleteConfirm(state)).toBeNull();
    expect(selectModelsConfigChangeCount(state)).toBe(0);
    expect(modelsConfigPanel.currentPage()).toEqual({ kind: "provider", name: "alpha" });
  });

  it("deletes the provider from the draft only once confirmed", () => {
    openModelsConfigProviderForm("alpha");
    requestModelsConfigProviderDelete("alpha");
    confirmModelsConfigDelete();
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toBeNull();
    expect(state.config.providers).not.toHaveProperty("alpha");
    expect(state.config.providers).toHaveProperty("beta");
    expect(state.selected).toBeNull();
    expect(selectModelsConfigChangeCount(state)).toBe(1);
    expect(modelsConfigPanel.currentPage().kind).toBe("root");
    expect(putModelsConfig).not.toHaveBeenCalled();
  });
});

describe("deleting a model waits for confirmation", () => {
  it("leaves the draft untouched while the request is pending", () => {
    requestModelsConfigModelDelete("alpha", 1);
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toEqual({ kind: "model", providerName: "alpha", index: 1 });
    expect(state.config).toEqual(baseline);
    expect(selectModelsConfigChangeCount(state)).toBe(0);
  });

  it("names the model in a lighter prompt", () => {
    requestModelsConfigModelDelete("alpha", 0);
    const prompt = selectModelsConfigDeleteConfirm(modelsConfigPanel.get());
    expect(prompt?.titleKey).toBe("Delete model");
    expect(prompt?.descriptionKey).toBe('Delete model "{name}"? This takes effect after saving.');
    expect(prompt?.params).toEqual({ name: "Alpha One" });
    expect(prompt?.affectedModelCount).toBe(1);
  });

  it("falls back to the model id, then to a placeholder name", () => {
    requestModelsConfigModelDelete("alpha", 1);
    expect(selectModelsConfigDeleteConfirm(modelsConfigPanel.get())?.params).toEqual({ name: "a-2" });
    modelsConfigPanel.patch({
      config: { providers: { alpha: { models: [{ id: "" }] } } },
      baseline: { providers: { alpha: { models: [{ id: "" }] } } },
    });
    requestModelsConfigModelDelete("alpha", 0);
    expect(selectModelsConfigDeleteConfirm(modelsConfigPanel.get())?.params).toEqual({ name: "Untitled model" });
  });

  it("is lossless when cancelled", () => {
    openModelsConfigModel("alpha", 1);
    requestModelsConfigModelDelete("alpha", 1);
    cancelModelsConfigDelete();
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toBeNull();
    expect(state.config).toEqual(baseline);
    expect(selectModelsConfigChangeCount(state)).toBe(0);
    expect(modelsConfigPanel.pageDepth()).toBe(2);
  });

  it("removes only the confirmed model and updates the change count", () => {
    openModelsConfigModel("alpha", 1);
    requestModelsConfigModelDelete("alpha", 1);
    confirmModelsConfigDelete();
    const state = modelsConfigPanel.get();
    expect(state.pendingDelete).toBeNull();
    expect(state.config.providers?.alpha?.models?.map((model) => model.id)).toEqual(["a-1", "a-3"]);
    expect(selectModelsConfigChangeCount(state)).toBe(1);
    expect(modelsConfigPanel.currentPage().kind).toBe("root");
    expect(putModelsConfig).not.toHaveBeenCalled();
  });
});

describe("stale delete requests", () => {
  it("ignores a request for a provider that no longer exists", () => {
    requestModelsConfigProviderDelete("missing");
    expect(modelsConfigPanel.get().pendingDelete).toBeNull();
    expect(selectModelsConfigDeleteConfirm(modelsConfigPanel.get())).toBeNull();
  });

  it("does nothing when confirming without a request", () => {
    confirmModelsConfigDelete();
    expect(modelsConfigPanel.get().config).toEqual(baseline);
    expect(modelsConfigPanel.get().pendingDelete).toBeNull();
  });

  it("drops a pending request when the draft is discarded", () => {
    requestModelsConfigProviderDelete("alpha");
    discardModelsConfigDraft();
    expect(modelsConfigPanel.get().pendingDelete).toBeNull();
    expect(modelsConfigPanel.get().config).toEqual(baseline);
  });
});
