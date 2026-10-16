import { describe, expect, it } from "vitest";
import {
  canonicalModelsJson,
  cloneModelFromCatalog,
  isModelsConfigDirty,
  modelsConfigDraftFrom,
  modelsConfigProblem,
  normalizeModelsJson,
  parseModelEntryJson,
  withAddedModel,
  withCustomProvider,
  withModel,
  withProvider,
  withRenamedProvider,
  withoutModel,
  withoutProvider,
  type ModelsConfigDraft,
} from "@/lib/shared/models-config-draft";
import type { ModelsJson } from "@/lib/shared/models-config";

/**
 * The models-config draft model (lib/shared/models-config-draft.ts): the
 * server payload arrives, the user edits, and exactly one rule decides whether
 * there is anything unsaved. Driven as plain data — no DOM, no fetch.
 */

function draft(config: ModelsJson, baseline?: ModelsJson): ModelsConfigDraft {
  return { config, baseline: baseline ?? config };
}

describe("normalizeModelsJson", () => {
  it("keeps a payload that already has a providers object", () => {
    const payload: ModelsJson = { providers: { openai: { apiKey: "sk" } } };
    expect(normalizeModelsJson(payload)).toBe(payload);
  });

  it("fills in an empty providers map when the key is missing", () => {
    expect(normalizeModelsJson({})).toEqual({ providers: {} });
    expect(normalizeModelsJson({ providers: null })).toEqual({ providers: {} });
  });

  it("falls back to an empty config for a non-object payload", () => {
    expect(normalizeModelsJson(null)).toEqual({ providers: {} });
    expect(normalizeModelsJson("nope")).toEqual({ providers: {} });
    expect(normalizeModelsJson([1, 2])).toEqual({ providers: {} });
  });
});

describe("modelsConfigDraftFrom", () => {
  it("starts clean, with config equal to baseline", () => {
    const result = modelsConfigDraftFrom({ providers: { openai: { apiKey: "sk" } } });
    expect(result.config).toBe(result.baseline);
    expect(isModelsConfigDirty(result)).toBe(false);
  });

  it("normalizes a payload with no providers into a clean draft", () => {
    expect(modelsConfigDraftFrom({}).config).toEqual({ providers: {} });
    expect(isModelsConfigDirty(modelsConfigDraftFrom({}))).toBe(false);
  });
});

describe("isModelsConfigDirty", () => {
  it("is false while the draft still equals the baseline", () => {
    expect(isModelsConfigDirty(draft({ providers: { a: { apiKey: "x" } } }))).toBe(false);
  });

  it("is true after a provider is added", () => {
    const { config } = withCustomProvider({ providers: {} });
    expect(isModelsConfigDirty(draft(config, { providers: {} }))).toBe(true);
  });

  it("is true after a nested model field changes", () => {
    const baseline: ModelsJson = { providers: { a: { models: [{ id: "gpt-4" }] } } };
    const edited: ModelsJson = { providers: { a: { models: [{ id: "gpt-4", name: "GPT-4" }] } } };
    expect(isModelsConfigDirty(draft(edited, baseline))).toBe(true);
  });

  it("ignores key order, so an edit that is undone is clean again", () => {
    const baseline: ModelsJson = { providers: { a: { api: "openai-completions", baseUrl: "https://x" } } };
    const reordered: ModelsJson = { providers: { a: { baseUrl: "https://x", api: "openai-completions" } } };
    expect(canonicalModelsJson(baseline)).toBe(canonicalModelsJson(reordered));
    expect(isModelsConfigDirty(draft(reordered, baseline))).toBe(false);
  });

  it("treats an empty payload's draft as clean against its normalized baseline", () => {
    expect(isModelsConfigDirty(modelsConfigDraftFrom({}))).toBe(false);
  });
});

describe("provider edits", () => {
  it("adds a custom provider under a unique name and selects it", () => {
    const first = withCustomProvider({ providers: {} });
    expect(first.name).toBe("new-provider");
    expect(first.config.providers?.["new-provider"]).toEqual({ api: "openai-completions" });

    const existing = { providers: { "new-provider": {}, "new-provider-1": {} } };
    expect(withCustomProvider(existing).name).toBe("new-provider-2");
  });

  it("replaces one provider without touching its neighbours", () => {
    const before: ModelsJson = { providers: { a: { apiKey: "1" }, b: { apiKey: "2" } } };
    const after = withProvider(before, "a", { apiKey: "3" });
    expect(after.providers).toEqual({ a: { apiKey: "3" }, b: { apiKey: "2" } });
    expect(before.providers).toEqual({ a: { apiKey: "1" }, b: { apiKey: "2" } });
  });

  it("renames a provider in place, preserving entry order", () => {
    const after = withRenamedProvider({ providers: { a: {}, b: {}, c: {} } }, "b", "beta");
    expect(Object.keys(after.providers ?? {})).toEqual(["a", "beta", "c"]);
  });

  it("keeps the config unchanged when renaming a missing provider", () => {
    const before: ModelsJson = { providers: { a: {} } };
    expect(withRenamedProvider(before, "missing", "x")).toBe(before);
  });

  it("deletes a provider's entry", () => {
    const after = withoutProvider({ providers: { a: {}, b: {} } }, "a");
    expect(after.providers).toEqual({ b: {} });
  });
});

describe("model edits", () => {
  it("appends an empty model and reports its index", () => {
    const { config, index } = withAddedModel({ providers: { a: { models: [{ id: "one" }] } } }, "a");
    expect(index).toBe(1);
    expect(config.providers?.a.models).toEqual([{ id: "one" }, { id: "" }]);
  });

  it("appends a provided model (e.g. cloned from the catalog)", () => {
    const { config, index } = withAddedModel({ providers: { a: {} } }, "a", { id: "gpt-4", name: "GPT-4" });
    expect(index).toBe(0);
    expect(config.providers?.a.models).toEqual([{ id: "gpt-4", name: "GPT-4" }]);
  });

  it("replaces one model entry by index", () => {
    const after = withModel({ providers: { a: { models: [{ id: "one" }, { id: "two" }] } } }, "a", 1, { id: "three" });
    expect(after.providers?.a.models).toEqual([{ id: "one" }, { id: "three" }]);
  });

  it("removes one model entry", () => {
    const after = withoutModel({ providers: { a: { models: [{ id: "one" }, { id: "two" }] } } }, "a", 0);
    expect(after.providers?.a.models).toEqual([{ id: "two" }]);
  });

  it("drops the models key when the last model is removed", () => {
    const after = withoutModel({ providers: { a: { models: [{ id: "one" }] } } }, "a", 0);
    expect(after.providers?.a).toEqual({});
  });
});

describe("cloneModelFromCatalog", () => {
  it("copies the editable fields and deep-copies the nested ones", () => {
    const source = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      api: "openai-completions",
      baseUrl: "https://api.openai.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.5 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const cloned = cloneModelFromCatalog(source);
    expect(cloned).toEqual({
      id: "gpt-4",
      name: "GPT-4",
      api: "openai-completions",
      reasoning: true,
      thinkingLevelMap: undefined,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.5, tiers: undefined },
      compat: undefined,
    });
    expect(cloned.input).not.toBe(source.input);
    expect(cloned.cost).not.toBe(source.cost);
  });
});

describe("parseModelEntryJson", () => {
  it("parses an object and keeps its fields", () => {
    const result = parseModelEntryJson('{"id":"gpt-4","name":"GPT-4","reasoning":true}');
    expect(result).toEqual({ ok: true, model: { id: "gpt-4", name: "GPT-4", reasoning: true } });
  });

  it("defaults a missing or non-string id to an empty string", () => {
    expect(parseModelEntryJson('{"name":"x"}')).toEqual({ ok: true, model: { name: "x", id: "" } });
    expect(parseModelEntryJson('{"id":5}')).toEqual({ ok: true, model: { id: "" } });
  });

  it("drops an empty icon so it does not shadow the provider's", () => {
    expect(parseModelEntryJson('{"id":"a","icon":""}')).toEqual({ ok: true, model: { id: "a" } });
  });

  it("reports a syntax error", () => {
    const result = parseModelEntryJson('{"id":"a"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("syntax");
  });

  it("rejects a non-object payload", () => {
    expect(parseModelEntryJson("[1,2]")) .toEqual({ ok: false, reason: "not-object", message: "not a JSON object" });
    expect(parseModelEntryJson("null")).toEqual({ ok: false, reason: "not-object", message: "not a JSON object" });
  });
});

describe("modelsConfigProblem", () => {
  it("is null when there is no raw edit", () => {
    expect(modelsConfigProblem(null)).toBeNull();
    expect(modelsConfigProblem(undefined)).toBeNull();
    expect(modelsConfigProblem("")).toBeNull();
  });

  it("is null while the raw text parses", () => {
    expect(modelsConfigProblem('{"id":"x"}')).toBeNull();
  });

  it("carries the parse error while the text is invalid", () => {
    const problem = modelsConfigProblem("{");
    expect(problem?.reason).toBe("syntax");
    expect(problem?.message).toBeTruthy();
  });

  it("flags a JSON payload that is not an object", () => {
    expect(modelsConfigProblem("42")).toEqual({ reason: "not-object", message: "not a JSON object" });
  });
});
