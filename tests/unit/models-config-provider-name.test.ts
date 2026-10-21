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
  releaseModelsConfigDraft, updateModelsConfigProvider, renameModelsConfigProvider,
  useModelsConfigStore as getStoreSnapshot, saveModelsConfig, selectModelsConfigDirty,
  selectModelsConfigProblem, openModelsConfigProvider,
} from "@/lib/client/models-config-store";

describe("provider name waits for explicit Save", () => {
  beforeEach(() => {
    releaseModelsConfigDraft();
    vi.mocked(putModelsConfig).mockClear();
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: true });
    updateModelsConfigProvider("original", { api: "openai-completions" });
    openModelsConfigProvider("original");
  });

  it("keeps config and navigation unchanged while typing, then renames on Save", async () => {
    const pages = getStoreSnapshot().pages;
    for (const text of ["n", "ne", "new"]) {
      renameModelsConfigProvider("original", text);
      const state = getStoreSnapshot();
      expect(state.config.providers).toHaveProperty("original");
      expect(state.config.providers).not.toHaveProperty(text);
      expect(state.pages).toBe(pages);
      expect(state.providerNames.original).toBe(text);
      expect(selectModelsConfigDirty(state)).toBe(true);
      expect(putModelsConfig).not.toHaveBeenCalled();
    }
    await saveModelsConfig();
    expect(putModelsConfig).toHaveBeenCalledWith({ providers: { new: { api: "openai-completions" } } });
    expect(getStoreSnapshot().config.providers).toHaveProperty("new");
    expect(getStoreSnapshot().providerNames).toEqual({});
    expect(selectModelsConfigDirty(getStoreSnapshot())).toBe(false);
  });

  it("keeps the original name and input when saving fails", async () => {
    vi.mocked(putModelsConfig).mockResolvedValue({ ok: false, error: "failed" });
    renameModelsConfigProvider("original", "new");
    await saveModelsConfig();
    expect(getStoreSnapshot().config.providers).toHaveProperty("original");
    expect(getStoreSnapshot().providerNames.original).toBe("new");
  });

  it("blocks empty and conflicting names without losing input", () => {
    renameModelsConfigProvider("original", " ");
    expect(selectModelsConfigProblem(getStoreSnapshot())?.reason).toBe("provider-name");
    updateModelsConfigProvider("existing", {});
    renameModelsConfigProvider("original", "existing");
    expect(selectModelsConfigProblem(getStoreSnapshot())?.reason).toBe("provider-name-conflict");
    expect(getStoreSnapshot().providerNames.original).toBe("existing");
  });
});
