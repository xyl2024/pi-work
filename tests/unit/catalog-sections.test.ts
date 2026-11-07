import { describe, expect, it } from "vitest";
import {
  catalogConfiguredKeys,
  catalogProviderRows,
  catalogSourceLabel,
  filterCatalogProviderRows,
} from "@/lib/shared/catalog-sections";
import type { ModelsJson, RuntimeCatalogProvider, RuntimeModelInfo } from "@/lib/shared/models-config";

function model(provider: string, id: string, name = id): RuntimeModelInfo {
  return {
    id,
    name,
    provider,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 4096,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  };
}

function provider(
  id: string,
  models: RuntimeModelInfo[],
  extra: Partial<RuntimeCatalogProvider> = {},
): RuntimeCatalogProvider {
  return {
    id,
    name: id,
    dynamic: false,
    auth: { configured: false },
    models,
    ...extra,
  };
}

const PROVIDERS = [
  provider("openai", [model("openai", "gpt-4o", "GPT-4o"), model("openai", "gpt-4o-mini", "GPT-4o mini")], {
    name: "OpenAI",
    dynamic: true,
    auth: { configured: true, label: "API key" },
  }),
  provider("local", [model("local", "llama-3")], { name: "Local endpoint", baseUrl: "https://local.test/v1" }),
  provider("empty", [], { name: "Empty provider" }),
];

const CONFIG: ModelsJson = {
  providers: {
    openai: { api: "openai-completions", models: [{ id: "gpt-4o" }] },
    "my-endpoint": { api: "openai-completions", models: [{ id: "llama-3" }, { id: "qwen-2" }] },
  },
};

describe("catalogConfiguredKeys", () => {
  it("collects provider names and every configured model id", () => {
    expect(catalogConfiguredKeys(CONFIG)).toEqual({
      providerIds: ["openai", "my-endpoint"],
      modelIds: ["gpt-4o", "llama-3", "qwen-2"],
    });
  });

  it("tolerates a missing or empty models.json", () => {
    expect(catalogConfiguredKeys(undefined)).toEqual({ providerIds: [], modelIds: [] });
    expect(catalogConfiguredKeys({})).toEqual({ providerIds: [], modelIds: [] });
    expect(catalogConfiguredKeys({ providers: { bare: {} } })).toEqual({ providerIds: ["bare"], modelIds: [] });
  });
});

describe("catalogSourceLabel", () => {
  it("names the built-in catalog static and the per-provider fetch dynamic", () => {
    expect(catalogSourceLabel(false)).toBe("Static catalog");
    expect(catalogSourceLabel(true)).toBe("Dynamic catalog");
  });
});

describe("catalogProviderRows", () => {
  const rows = catalogProviderRows({ providers: PROVIDERS, configured: catalogConfiguredKeys(CONFIG) });

  it("keeps catalog order and carries identity, base url and model count", () => {
    expect(rows.map((row) => row.id)).toEqual(["openai", "local", "empty"]);
    expect(rows[0]).toMatchObject({ name: "OpenAI", modelCount: 2 });
    expect(rows[1]).toMatchObject({ name: "Local endpoint", baseUrl: "https://local.test/v1", modelCount: 1 });
    expect(rows[2].modelCount).toBe(0);
  });

  it("marks a provider configured when models.json defines it", () => {
    expect(rows.map((row) => row.configured)).toEqual([true, false, false]);
  });

  it("carries source and authentication state per provider", () => {
    expect(rows[0]).toMatchObject({ source: "dynamic", sourceLabel: "Dynamic catalog", auth: { configured: true, label: "API key" } });
    expect(rows[1]).toMatchObject({ source: "static", sourceLabel: "Static catalog", auth: { configured: false, label: null } });
  });

  it("flags catalog models that already exist in models.json", () => {
    const models = rows.flatMap((row) => row.models.map((item) => [item.model.id, item.configured] as const));

    expect(models).toEqual([
      ["gpt-4o", true],
      ["gpt-4o-mini", false],
      ["llama-3", true],
    ]);
    expect(rows[0].models.map((item) => item.key)).toEqual(["openai:0:gpt-4o", "openai:1:gpt-4o-mini"]);
  });
});

describe("filterCatalogProviderRows", () => {
  const rows = catalogProviderRows({ providers: PROVIDERS, configured: catalogConfiguredKeys(CONFIG) });

  it("returns every row for a blank query", () => {
    expect(filterCatalogProviderRows(rows, "").map((row) => row.id)).toEqual(["openai", "local", "empty"]);
    expect(filterCatalogProviderRows(rows, "   ")[0].modelCount).toBe(2);
  });

  it("narrows a provider to its matching models and recounts them", () => {
    const openai = filterCatalogProviderRows(rows, "MINI");

    expect(openai.map((row) => row.id)).toEqual(["openai"]);
    expect(openai[0].models.map((item) => item.model.id)).toEqual(["gpt-4o-mini"]);
    expect(openai[0].modelCount).toBe(1);
  });

  it("keeps every model of a provider matched by its own name or id", () => {
    expect(filterCatalogProviderRows(rows, "local").flatMap((row) => row.models.map((item) => item.model.id))).toEqual(["llama-3"]);
    expect(filterCatalogProviderRows(rows, "OpenAI")[0].modelCount).toBe(2);
  });

  it("matches provider base url and model api", () => {
    expect(filterCatalogProviderRows(rows, "local.test").map((row) => row.id)).toEqual(["local"]);
    expect(filterCatalogProviderRows(rows, "openai-completions")).toHaveLength(2);
  });

  it("drops rows without a provider or model hit", () => {
    expect(filterCatalogProviderRows(rows, "gpt-5")).toEqual([]);
  });
});
