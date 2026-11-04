import { describe, expect, it } from "vitest";
import {
  filterModelsConfigProviderRows,
  modelsConfigProviderRows,
  type ModelsConfigProviderRow,
} from "@/lib/shared/models-config-filter";

const ROWS: ModelsConfigProviderRow[] = [
  { id: "openai", name: "OpenAI", kind: "subscription", modelCount: 0 },
  { id: "anthropic", name: "Anthropic", kind: "apiKey", modelCount: 3 },
  { id: "my-endpoint", name: "my-endpoint", kind: "custom", modelCount: 2 },
];

describe("modelsConfigProviderRows", () => {
  it("lists subscriptions, api-key providers and custom providers with a type and a model count", () => {
    const rows = modelsConfigProviderRows({
      oauthProviders: [
        { id: "openai", name: "OpenAI", usesCallbackServer: false, loggedIn: true },
        { id: "hidden", name: "Hidden", usesCallbackServer: false, loggedIn: false },
      ],
      apiKeyProviders: [
        { id: "anthropic", displayName: "Anthropic", configured: true, modelCount: 3 },
        { id: "unset", displayName: "Unset", configured: false, modelCount: 0 },
      ],
      providers: {
        "my-endpoint": { api: "openai-completions", models: [{ id: "m-1" }, { id: "m-2" }] },
      },
    });

    expect(rows).toEqual([
      { id: "openai", name: "OpenAI", kind: "subscription", modelCount: 0 },
      { id: "anthropic", name: "Anthropic", kind: "apiKey", modelCount: 3 },
      { id: "my-endpoint", name: "my-endpoint", kind: "custom", modelCount: 2 },
    ]);
  });
});

describe("filterModelsConfigProviderRows", () => {
  it("keeps every row for a blank or whitespace query", () => {
    expect(filterModelsConfigProviderRows(ROWS, "")).toEqual(ROWS);
    expect(filterModelsConfigProviderRows(ROWS, "   ")).toEqual(ROWS);
  });

  it("matches the name and the id case-insensitively", () => {
    expect(filterModelsConfigProviderRows(ROWS, "endpoint")).toEqual([ROWS[2]]);
    expect(filterModelsConfigProviderRows(ROWS, "ANTHROPIC")).toEqual([ROWS[1]]);
    expect(filterModelsConfigProviderRows(ROWS, "my-")).toEqual([ROWS[2]]);
    expect(filterModelsConfigProviderRows(ROWS, "missing")).toEqual([]);
  });
});
