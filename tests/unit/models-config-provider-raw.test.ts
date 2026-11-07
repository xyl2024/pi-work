import { readFileSync } from "node:fs";
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
  applyModelsConfigProviderRawEdit,
  beginModelsConfigProviderRawEdit,
  cancelModelsConfigProviderRawEdit,
  clearModelsConfigProvider,
  modelsConfigPanel,
  openModelsConfigProviderForm,
  selectModelsConfigProblem,
  updateModelsConfigProvider,
  updateModelsConfigProviderRawEdit,
} from "@/lib/client/models-config-panel";

const providerName = "new-provider";

function provider() {
  return modelsConfigPanel.get().config.providers?.[providerName];
}

beforeEach(() => {
  modelsConfigPanel.release();
  addModelsConfigCustomProvider();
});

describe("provider raw JSON editing", () => {
  it("writes a parsed provider into the draft", () => {
    beginModelsConfigProviderRawEdit(providerName, '{"api":"openai-completions"}');
    updateModelsConfigProviderRawEdit('{"api":"anthropic-messages","baseUrl":"https://example.test"}');
    expect(provider()).toEqual({ api: "anthropic-messages", baseUrl: "https://example.test" });
  });

  it("keeps the last valid provider while the text has a syntax error", () => {
    updateModelsConfigProvider(providerName, { api: "openai-completions", baseUrl: "https://kept.test" });
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(provider()));
    updateModelsConfigProviderRawEdit("{");
    expect(provider()).toEqual({ api: "openai-completions", baseUrl: "https://kept.test" });
    const problem = selectModelsConfigProblem(modelsConfigPanel.get());
    expect(problem?.reason).toBe("syntax");
    expect(problem?.location).toEqual({ providerName, index: null });
  });

  it("rejects a non-object payload", () => {
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(provider()));
    updateModelsConfigProviderRawEdit("[]");
    expect(selectModelsConfigProblem(modelsConfigPanel.get())?.reason).toBe("not-object");
  });

  it("applies only valid JSON", () => {
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(provider()));
    updateModelsConfigProviderRawEdit("{");
    applyModelsConfigProviderRawEdit();
    expect(modelsConfigPanel.get().providerRawEdit).not.toBeNull();
    updateModelsConfigProviderRawEdit('{"api":"google-generative-ai"}');
    applyModelsConfigProviderRawEdit();
    expect(modelsConfigPanel.get().providerRawEdit).toBeNull();
    expect(provider()).toEqual({ api: "google-generative-ai" });
  });

  it("restores the original provider on cancel", () => {
    const original = provider();
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(original));
    updateModelsConfigProviderRawEdit('{"api":"anthropic-messages"}');
    cancelModelsConfigProviderRawEdit();
    expect(modelsConfigPanel.get().providerRawEdit).toBeNull();
    expect(provider()).toEqual(original);
  });

  it("drops the raw buffer when the provider form is reopened", () => {
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(provider()));
    updateModelsConfigProviderRawEdit('{"api":"anthropic-messages"}');
    openModelsConfigProviderForm(providerName);
    expect(modelsConfigPanel.get().providerRawEdit).toBeNull();
  });

  it("drops the raw buffer when the selection is cleared", () => {
    beginModelsConfigProviderRawEdit(providerName, JSON.stringify(provider()));
    updateModelsConfigProviderRawEdit('{"api":"anthropic-messages"}');
    clearModelsConfigProvider();
    expect(modelsConfigPanel.get().providerRawEdit).toBeNull();
  });
});

describe("provider form mount", () => {
  it("does not write defaults from the fields component", () => {
    const source = readFileSync("components/settings/models-config/ProviderFields.tsx", "utf8");
    expect(source).not.toContain("useEffect");
  });

  it("starts a new provider with its default API already in the draft", () => {
    const before = new Set(Object.keys(modelsConfigPanel.get().config.providers ?? {}));
    addModelsConfigCustomProvider();
    const providers = modelsConfigPanel.get().config.providers ?? {};
    const added = Object.keys(providers).find((key) => !before.has(key));
    expect(added).toBeDefined();
    expect(providers[added!]).toEqual({ api: "openai-completions" });
  });
});
