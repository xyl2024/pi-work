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
  addModelsConfigModel,
  focusModelsConfigProblem,
  modelsConfigPanel,
  openModelsConfigProviderForm,
  renameModelsConfigProvider,
  revertModelsConfigDraft,
  saveModelsConfig,
  selectModelsConfigChangeCount,
  selectModelsConfigProblem,
  selectModelsConfigSaveBarPhase,
  updateModelsConfigModel,
  updateModelsConfigProvider,
} from "@/lib/client/models-config-panel";
import type { ModelsJson } from "@/lib/shared/models-config";

const baseline: ModelsJson = {
  providers: {
    alpha: { api: "openai-completions", models: [{ id: "a-1" }] },
  },
};

function seed(): void {
  modelsConfigPanel.patch({ config: baseline, baseline, providerNames: {}, rawEdit: null });
}

beforeEach(() => {
  modelsConfigPanel.release();
  vi.mocked(putModelsConfig).mockReset();
  vi.mocked(putModelsConfig).mockResolvedValue({ ok: true });
  modelsConfigPanel.patch({
    saving: false,
    savedOk: false,
    saveError: null,
    selectedProvider: null,
  });
  seed();
});

describe("save bar phases", () => {
  it("is clean right after loading", () => {
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("clean");
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(0);
  });

  it("is dirty with the number of changed providers", () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", models: [{ id: "a-1", name: "A" }] });
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("dirty");
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("counts a renamed provider as one change", () => {
    renameModelsConfigProvider("alpha", "alpha-2");
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("does not double count a provider that is both renamed and edited", () => {
    renameModelsConfigProvider("alpha", "alpha-2");
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("blocks saving on a blank provider name", () => {
    renameModelsConfigProvider("alpha", " ");
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("blocked");
    expect(selectModelsConfigProblem(modelsConfigPanel.get())?.location.providerName).toBe("alpha");
  });

  it("blocks saving on a blank model id and locates the model", () => {
    addModelsConfigModel("alpha");
    const problem = selectModelsConfigProblem(modelsConfigPanel.get());
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("blocked");
    expect(problem?.reason).toBe("empty-model-id");
    expect(problem?.location).toEqual({ providerName: "alpha", index: 1 });
  });

  it("is saving while the write is in flight", async () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    let finish: (value: { ok: boolean }) => void = () => {};
    vi.mocked(putModelsConfig).mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const pending = saveModelsConfig();
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("saving");
    finish({ ok: true });
    await pending;
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("saved");
  });

  it("is failed with the draft kept when the write fails", async () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: false, error: "network down" });
    await saveModelsConfig();
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("failed");
    expect(modelsConfigPanel.get().saveError).toBe("network down");
    expect(modelsConfigPanel.get().config.providers?.alpha).toHaveProperty("baseUrl", "https://x");
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
  });

  it("returns to clean once the save succeeds", async () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    await saveModelsConfig();
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(0);
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("saved");
  });
});

describe("jumping to a problem", () => {
  it("opens the provider form for a provider level problem", () => {
    renameModelsConfigProvider("alpha", " ");
    const problem = selectModelsConfigProblem(modelsConfigPanel.get());
    expect(problem).not.toBeNull();
    focusModelsConfigProblem(problem!);
    expect(modelsConfigPanel.pages().map((page) => page.kind)).toEqual(["root", "provider"]);
    expect(modelsConfigPanel.currentPage()).toEqual({ kind: "provider", name: "alpha" });
  });

  it("opens the model form for a model level problem", () => {
    addModelsConfigModel("alpha");
    const problem = selectModelsConfigProblem(modelsConfigPanel.get());
    focusModelsConfigProblem(problem!);
    expect(modelsConfigPanel.pages().map((page) => page.kind)).toEqual(["root", "model"]);
    expect(modelsConfigPanel.currentPage()).toEqual({ kind: "model", providerName: "alpha", index: 1 });
  });

  it("keeps two levels when jumping from an open form", () => {
    addModelsConfigModel("alpha");
    const problem = selectModelsConfigProblem(modelsConfigPanel.get())!;
    focusModelsConfigProblem(problem);
    focusModelsConfigProblem(problem);
    expect(modelsConfigPanel.pageDepth()).toBe(2);
  });
});

describe("revert all", () => {
  it("rolls the draft back to the baseline and zeroes the count", () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    updateModelsConfigModel("alpha", 0, { id: "a-1", name: "renamed" });
    renameModelsConfigProvider("alpha", "alpha-2");
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(1);
    revertModelsConfigDraft();
    expect(modelsConfigPanel.get().config).toEqual(baseline);
    expect(modelsConfigPanel.get().providerNames).toEqual({});
    expect(selectModelsConfigChangeCount(modelsConfigPanel.get())).toBe(0);
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("clean");
  });

  it("keeps the current page stack", () => {
    openModelsConfigProviderForm("alpha");
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    revertModelsConfigDraft();
    expect(modelsConfigPanel.pages().map((page) => page.kind)).toEqual(["root", "provider"]);
    expect(modelsConfigPanel.pageDepth()).toBe(2);
  });

  it("clears a stale save error so the bar is not stuck", async () => {
    updateModelsConfigProvider("alpha", { api: "openai-completions", baseUrl: "https://x" });
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: false, error: "network down" });
    await saveModelsConfig();
    revertModelsConfigDraft();
    expect(modelsConfigPanel.get().saveError).toBeNull();
    expect(selectModelsConfigSaveBarPhase(modelsConfigPanel.get())).toBe("clean");
  });
});
