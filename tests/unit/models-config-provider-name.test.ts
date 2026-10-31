import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() }));
vi.mock("@/lib/client/models-config-io", () => ({
  fetchApiKeyProviders: vi.fn(async () => []),
  fetchOAuthProviders: vi.fn(async () => []),
  fetchModelsConfigPayload: vi.fn(),
  putModelsConfig: vi.fn(async () => ({ ok: true })),
}));

import { putModelsConfig } from "@/lib/client/models-config-io";
import {
  modelsConfigPanel, updateModelsConfigProvider, renameModelsConfigProvider,
  saveModelsConfig, selectModelsConfigDirty,
  selectModelsConfigProblem, openModelsConfigProvider,
} from "@/lib/client/models-config-panel";

describe("provider name waits for explicit Save", () => {
  beforeEach(() => {
    modelsConfigPanel.release();
    vi.mocked(putModelsConfig).mockClear();
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: true });
    updateModelsConfigProvider("original", { api: "openai-completions" });
    openModelsConfigProvider("original");
  });

  it("keeps config and navigation unchanged while typing, then renames on Save", async () => {
    const pages = modelsConfigPanel.pages();
    for (const text of ["n", "ne", "new"]) {
      renameModelsConfigProvider("original", text);
      const state = modelsConfigPanel.get();
      expect(state.config.providers).toHaveProperty("original");
      expect(state.config.providers).not.toHaveProperty(text);
      expect(modelsConfigPanel.pages()).toBe(pages);
      expect(state.providerNames.original).toBe(text);
      expect(selectModelsConfigDirty(state)).toBe(true);
      expect(putModelsConfig).not.toHaveBeenCalled();
    }
    await saveModelsConfig();
    expect(putModelsConfig).toHaveBeenCalledWith({ providers: { new: { api: "openai-completions" } } });
    expect(modelsConfigPanel.get().config.providers).toHaveProperty("new");
    expect(modelsConfigPanel.get().providerNames).toEqual({});
    expect(selectModelsConfigDirty(modelsConfigPanel.get())).toBe(false);
  });

  it("keeps the original name and input when saving fails", async () => {
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: false, error: "failed" });
    renameModelsConfigProvider("original", "new");
    await saveModelsConfig();
    expect(modelsConfigPanel.get().config.providers).toHaveProperty("original");
    expect(modelsConfigPanel.get().providerNames.original).toBe("new");
  });

  it("blocks empty and conflicting names without losing input", () => {
    renameModelsConfigProvider("original", " ");
    expect(selectModelsConfigProblem(modelsConfigPanel.get())?.reason).toBe("provider-name");
    updateModelsConfigProvider("existing", {});
    renameModelsConfigProvider("original", "existing");
    expect(selectModelsConfigProblem(modelsConfigPanel.get())?.reason).toBe("provider-name-conflict");
    expect(modelsConfigPanel.get().providerNames.original).toBe("existing");
  });
});
