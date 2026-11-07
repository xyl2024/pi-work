import { describe, expect, it } from "vitest";
import {
  CATALOG_RESULT_LIMIT,
  catalogSearchResults,
  moveCatalogHighlight,
  type CatalogModelEntry,
} from "@/lib/shared/catalog-search";
import type { RuntimeModelInfo } from "@/lib/shared/models-config";

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

function entry(provider: string, id: string, providerName = provider): CatalogModelEntry {
  return { model: model(provider, id), providerName };
}

const ENTRIES = [
  entry("openai", "gpt-4o", "OpenAI"),
  entry("anthropic", "claude-3-5-sonnet", "Anthropic"),
  entry("local", "llama-3-70b", "Local endpoint"),
];

describe("catalogSearchResults", () => {
  it("returns every entry for an empty query", () => {
    expect(catalogSearchResults(ENTRIES, "")).toHaveLength(3);
    expect(catalogSearchResults(ENTRIES, "   ")).toHaveLength(3);
  });

  it("matches model id, provider id, provider name and model payload case-insensitively", () => {
    expect(catalogSearchResults(ENTRIES, "GPT-4O").map((hit) => hit.model.id)).toEqual(["gpt-4o"]);
    expect(catalogSearchResults(ENTRIES, "anthropic").map((hit) => hit.model.id)).toEqual(["claude-3-5-sonnet"]);
    expect(catalogSearchResults(ENTRIES, "local endpoint").map((hit) => hit.model.id)).toEqual(["llama-3-70b"]);
    expect(catalogSearchResults(ENTRIES, "openai-completions")).toHaveLength(3);
  });

  it("returns no hits when nothing matches", () => {
    expect(catalogSearchResults(ENTRIES, "gpt-5")).toEqual([]);
  });

  it("caps the results at the catalog limit", () => {
    const many = Array.from({ length: CATALOG_RESULT_LIMIT + 25 }, (_, index) =>
      entry("openai", `model-${String(index).padStart(3, "0")}`),
    );
    expect(CATALOG_RESULT_LIMIT).toBe(200);
    expect(catalogSearchResults(many, "")).toHaveLength(200);
    expect(catalogSearchResults(many, "model-")[0]?.model.id).toBe("model-000");
  });
});

describe("moveCatalogHighlight", () => {
  it("wraps down from the last result to the first", () => {
    expect(moveCatalogHighlight(2, 3, 1)).toBe(0);
  });

  it("wraps up from the first result to the last", () => {
    expect(moveCatalogHighlight(0, 3, -1)).toBe(2);
  });

  it("moves step by step inside the list", () => {
    expect(moveCatalogHighlight(1, 3, 1)).toBe(2);
    expect(moveCatalogHighlight(1, 3, -1)).toBe(0);
  });

  it("stays at zero when there are no results", () => {
    expect(moveCatalogHighlight(0, 0, 1)).toBe(0);
    expect(moveCatalogHighlight(4, 0, -1)).toBe(0);
  });
});
