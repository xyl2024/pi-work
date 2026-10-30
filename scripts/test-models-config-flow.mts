import assert from "node:assert/strict";
import { filterCatalogModels } from "../components/settings/models-config/catalog-search.ts";
import type { RuntimeModelInfo } from "../components/settings/models-config/types.ts";

function makeModel(overrides: Partial<RuntimeModelInfo> = {}): RuntimeModelInfo {
  return {
    id: "test-model",
    name: "Test Model",
    provider: "test-provider",
    api: "openai-completions",
    baseUrl: "https://api.test.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 16384,
    ...overrides,
  };
}

const CATALOG = [
  { model: makeModel({ id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000 }), providerName: "openai" },
  { model: makeModel({ id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", reasoning: true }), providerName: "anthropic" },
  { model: makeModel({ id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek", input: ["text", "image"] }), providerName: "deepseek" },
];

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

test("empty query returns all models", () => {
  assert.equal(filterCatalogModels(CATALOG, "").length, 3);
  assert.equal(filterCatalogModels(CATALOG, "   ").length, 3);
});

test("matches model id (case-insensitive)", () => {
  const hits = filterCatalogModels(CATALOG, "GPT-4O");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].model.id, "gpt-4o");
});

test("matches model display name", () => {
  const hits = filterCatalogModels(CATALOG, "sonnet");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].model.id, "claude-sonnet-4");
});

test("matches provider name", () => {
  const hits = filterCatalogModels(CATALOG, "deepseek");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].model.id, "deepseek-chat");
});

test("full-text matches nested metadata (input modality)", () => {
  const hits = filterCatalogModels(CATALOG, "image");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].model.id, "deepseek-chat");
});

test("full-text matches nested metadata (context window)", () => {
  const hits = filterCatalogModels(CATALOG, "128000");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].model.id, "gpt-4o");
});

test("no match returns empty list", () => {
  assert.equal(filterCatalogModels(CATALOG, "no-such-model").length, 0);
});

test("does not mutate the input list", () => {
  const snapshot = JSON.stringify(CATALOG);
  filterCatalogModels(CATALOG, "gpt");
  assert.equal(JSON.stringify(CATALOG), snapshot);
});

console.log(`\n${passed} tests passed`);
