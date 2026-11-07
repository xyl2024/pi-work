import { describe, expect, it } from "vitest";
import {
  filterModelsConfigShelfSections,
  modelsConfigShelfSections,
} from "@/lib/shared/models-config-shelf";

const INPUT = {
  oauthProviders: [
    { id: "openai", name: "OpenAI", usesCallbackServer: false, loggedIn: false },
    { id: "google", name: "Google", usesCallbackServer: false, loggedIn: true },
  ],
  apiKeyProviders: [
    { id: "acme", displayName: "Acme", configured: false, modelCount: 3 },
    { id: "groq", displayName: "Groq", configured: true, modelCount: 8 },
  ],
};

describe("modelsConfigShelfSections", () => {
  it("lists only providers that still need credentials", () => {
    const sections = modelsConfigShelfSections(INPUT);

    expect(sections.map((section) => section.kind)).toEqual(["subscription", "apiKey", "custom"]);
    expect(sections.map((section) => section.rows.map((row) => row.id))).toEqual([
      ["openai"],
      ["acme"],
      ["custom"],
    ]);
  });

  it("points each section at the page that finishes the connection", () => {
    const sections = modelsConfigShelfSections(INPUT);

    expect(sections.map((section) => section.rows[0].action)).toEqual([
      "connect",
      "configure",
      "create",
    ]);
  });

  it("describes the source of each provider", () => {
    const sections = modelsConfigShelfSections(INPUT);
    const [oauth, apiKey, custom] = sections.map((section) => section.rows[0]);

    expect(oauth.summaryKey).toBe("Subscription · OAuth sign-in");
    expect(apiKey.summaryKey).toBe("API Key · {n} models");
    expect(apiKey.summaryParams).toEqual({ n: 3 });
    expect(custom.summaryKey).toBe("Custom · Base URL + Key");
  });

  it("names the custom row after the endpoint format it accepts", () => {
    const custom = modelsConfigShelfSections(INPUT)[2].rows[0];

    expect(custom.name).toBe("OpenAI / Anthropic compatible");
    expect(custom.actionLabelKey).toBe("Create");
  });
});

describe("filterModelsConfigShelfSections", () => {
  it("keeps every section when the query is empty", () => {
    const sections = modelsConfigShelfSections(INPUT);

    expect(filterModelsConfigShelfSections(sections, "  ")).toEqual(sections);
  });

  it("matches provider names case-insensitively", () => {
    const sections = filterModelsConfigShelfSections(modelsConfigShelfSections(INPUT), "acme");

    expect(sections.map((section) => section.kind)).toEqual(["apiKey"]);
    expect(sections[0].rows.map((row) => row.id)).toEqual(["acme"]);
  });

  it("matches the custom row through its endpoint keywords", () => {
    const sections = modelsConfigShelfSections(INPUT);
    const forKeywords = (query: string) =>
      filterModelsConfigShelfSections(sections, query).flatMap((section) =>
        section.rows.map((row) => row.id),
      );

    expect(forKeywords("openai-compatible")).toEqual(["custom"]);
    expect(forKeywords("base url")).toEqual(["custom"]);
    expect(forKeywords("oauth")).toEqual(["openai"]);
  });

  it("drops every section when nothing matches", () => {
    expect(filterModelsConfigShelfSections(modelsConfigShelfSections(INPUT), "zzz")).toEqual([]);
  });

  it("lets the caller add translated keywords for the custom row", () => {
    const sections = modelsConfigShelfSections({ ...INPUT, customKeywords: ["自定义"] });

    expect(
      filterModelsConfigShelfSections(sections, "自定义").flatMap((section) =>
        section.rows.map((row) => row.id),
      ),
    ).toEqual(["custom"]);
  });
});
