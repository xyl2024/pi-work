import { describe, expect, it } from "vitest";
import {
  filterModelsConfigProviderSections,
  modelsConfigProviderSections,
  type ModelsConfigProviderSection,
} from "@/lib/shared/models-config-filter";

const INPUT = {
  oauthProviders: [
    { id: "openai", name: "OpenAI", usesCallbackServer: false, loggedIn: true },
    { id: "google", name: "Google", usesCallbackServer: false, loggedIn: true },
    { id: "hidden", name: "Hidden", usesCallbackServer: false, loggedIn: false },
  ],
  apiKeyProviders: [
    { id: "anthropic", displayName: "Anthropic", configured: true, modelCount: 3 },
    { id: "unset", displayName: "Unset", configured: false, modelCount: 0 },
  ],
  providers: {
    "my-endpoint": {
      api: "openai-completions",
      models: [
        { id: "claude-3-5-sonnet", name: "Claude Sonnet 3.5" },
        { id: "gpt-4o" },
      ],
    },
    "another-endpoint": { api: "openai-completions" },
  },
};

describe("modelsConfigProviderSections", () => {
  it("groups configured providers into subscription, api key and custom sections", () => {
    const sections = modelsConfigProviderSections(INPUT);

    expect(sections.map((section) => section.kind)).toEqual(["subscription", "apiKey", "custom"]);
    expect(sections.map((section) => section.rows.map((row) => row.id))).toEqual([
      ["google", "openai"],
      ["anthropic"],
      ["another-endpoint", "my-endpoint"],
    ]);
  });

  it("sorts rows by name inside a section, ignoring case", () => {
    const sections = modelsConfigProviderSections(INPUT);

    expect(sections[0].rows.map((row) => row.name)).toEqual(["Google", "OpenAI"]);
    expect(sections[2].rows.map((row) => row.name)).toEqual(["another-endpoint", "my-endpoint"]);
  });

  it("carries the model count and the model labels of each provider", () => {
    const custom = modelsConfigProviderSections(INPUT)[2];
    const endpoint = custom.rows.find((row) => row.id === "my-endpoint");

    expect(endpoint?.modelCount).toBe(2);
    expect(endpoint?.models).toEqual([
      { id: "claude-3-5-sonnet", name: "Claude Sonnet 3.5" },
      { id: "gpt-4o", name: "gpt-4o" },
    ]);
    expect(modelsConfigProviderSections(INPUT)[1].rows[0].modelCount).toBe(3);
  });

  it("uses the draft name of a renamed custom provider", () => {
    const custom = modelsConfigProviderSections({ ...INPUT, providerNames: { "my-endpoint": "Aardvark" } })[2];

    expect(custom.rows.map((row) => row.name)).toEqual(["Aardvark", "another-endpoint"]);
  });

  it("marks custom providers that have unsaved changes and keys every row by kind and id", () => {
    const sections = modelsConfigProviderSections({ ...INPUT, changedProviders: ["my-endpoint"] });
    const custom = sections[2];

    expect(custom.rows.map((row) => [row.key, row.changed])).toEqual([
      ["custom:another-endpoint", false],
      ["custom:my-endpoint", true],
    ]);
    expect(sections[1].rows[0]).toMatchObject({ key: "apiKey:anthropic", changed: false });
  });
});

describe("filterModelsConfigProviderSections", () => {
  const SECTIONS = modelsConfigProviderSections(INPUT);

  it("keeps every non-empty section for a blank or whitespace query", () => {
    expect(filterModelsConfigProviderSections(SECTIONS, "")).toEqual(SECTIONS);
    expect(filterModelsConfigProviderSections(SECTIONS, "   ")).toEqual(SECTIONS);
  });

  it("matches the provider name, the provider id and the model names case-insensitively", () => {
    expect(filterModelsConfigProviderSections(SECTIONS, "ANTHROPIC").map((s) => s.rows.map((r) => r.id))).toEqual([["anthropic"]]);
    expect(filterModelsConfigProviderSections(SECTIONS, "openai").map((s) => s.rows.map((r) => r.id))).toEqual([["openai"]]);
    expect(filterModelsConfigProviderSections(SECTIONS, "sonnet").map((s) => s.rows.map((r) => r.id))).toEqual([["my-endpoint"]]);
  });

  it("previews the models that matched the query", () => {
    const [social] = filterModelsConfigProviderSections(SECTIONS, "gpt");

    expect(social.rows[0].matchedModels).toEqual(["gpt-4o"]);
  });

  it("matches a model id and previews its label", () => {
    const [custom] = filterModelsConfigProviderSections(SECTIONS, "claude-3-5");

    expect(custom.rows[0].matchedModels).toEqual(["Claude Sonnet 3.5"]);
  });

  it("previews nothing when only the provider itself matched", () => {
    const [apiKey] = filterModelsConfigProviderSections(SECTIONS, "anthropic");

    expect(apiKey.rows[0].matchedModels).toEqual([]);
  });

  it("drops sections left without rows and returns no section when nothing matches", () => {
    expect(filterModelsConfigProviderSections(SECTIONS, "nothing-here")).toEqual([]);

    const [custom] = filterModelsConfigProviderSections(SECTIONS, "endpoint");
    expect(custom.kind).toBe("custom");
    expect(custom.rows.map((row) => row.id)).toEqual(["another-endpoint", "my-endpoint"]);
  });

  it("does not mutate the sections it was given", () => {
    const before = JSON.parse(JSON.stringify(SECTIONS)) as ModelsConfigProviderSection[];

    filterModelsConfigProviderSections(SECTIONS, "gpt");

    expect(SECTIONS).toEqual(before);
  });
});
