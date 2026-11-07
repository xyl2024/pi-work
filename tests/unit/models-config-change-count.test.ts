import { describe, expect, it } from "vitest";
import {
  missingModelIdProblem,
  modelsConfigChangeCount,
  modelsConfigChangedProviders,
  modelsConfigProblem,
  parseModelEntryJson,
  parseProviderEntryJson,
  withAddedModel,
  withCustomProvider,
  withModel,
  withProvider,
  withoutProvider,
} from "@/lib/shared/models-config-draft";
import type { ModelsJson } from "@/lib/shared/models-config";

const baseline: ModelsJson = {
  providers: {
    alpha: { api: "openai-completions", models: [{ id: "a-1" }, { id: "a-2" }] },
    beta: { api: "anthropic", models: [{ id: "b-1" }] },
  },
};

describe("modelsConfigChangedProviders", () => {
  it("is empty while the draft equals the baseline", () => {
    expect(modelsConfigChangedProviders({ config: baseline, baseline })).toEqual([]);
  });

  it("names the provider whose nested model changed", () => {
    const config = withModel(baseline, "beta", 0, { id: "b-1", name: "Beta One" });
    expect(modelsConfigChangedProviders({ config, baseline })).toEqual(["beta"]);
    expect(modelsConfigChangeCount({ config, baseline })).toBe(1);
  });

  it("counts added and removed providers", () => {
    const added = withCustomProvider(baseline);
    expect(modelsConfigChangedProviders({ config: added.config, baseline })).toEqual(["new-provider"]);
    const removed = withoutProvider(baseline, "alpha");
    expect(modelsConfigChangedProviders({ config: removed, baseline })).toEqual(["alpha"]);
  });

  it("counts each touched provider once", () => {
    let config = withModel(baseline, "alpha", 0, { id: "a-1", name: "Alpha One" });
    config = withModel(config, "alpha", 1, { id: "a-2", maxTokens: 100 });
    config = withModel(config, "beta", 0, { id: "b-1", reasoning: true });
    expect(modelsConfigChangedProviders({ config, baseline })).toEqual(["alpha", "beta"]);
    expect(modelsConfigChangeCount({ config, baseline })).toBe(2);
  });

  it("drops back to zero when an edit is undone", () => {
    const edited = withModel(baseline, "alpha", 0, { id: "a-1", name: "Typed" });
    expect(modelsConfigChangeCount({ config: edited, baseline })).toBe(1);
    const undone = withModel(edited, "alpha", 0, { id: "a-1" });
    expect(modelsConfigChangeCount({ config: undone, baseline })).toBe(0);
  });

  it("counts a provider added and then removed back to nothing", () => {
    const added = withCustomProvider(baseline);
    const removed = withoutProvider(added.config, added.name);
    expect(modelsConfigChangeCount({ config: removed, baseline })).toBe(0);
  });
});

describe("provider raw JSON uses the model raw JSON rules", () => {
  it("rejects broken syntax", () => {
    const parsed = parseProviderEntryJson("{");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("syntax");
  });

  it("rejects values that are not objects", () => {
    for (const text of ["[]", "42", "null", '"x"']) {
      const parsed = parseProviderEntryJson(text);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("not-object");
    }
  });

  it("accepts an object as a provider entry", () => {
    const parsed = parseProviderEntryJson('{"api":"openai-completions"}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.provider).toEqual({ api: "openai-completions" });
  });

  it("keeps the model rules unchanged", () => {
    const parsed = parseModelEntryJson('{"name":"no id"}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.model.id).toBe("");
  });
});

describe("modelsConfigProblem locations", () => {
  it("carries no location without a provider", () => {
    const problem = modelsConfigProblem("{");
    expect(problem?.reason).toBe("syntax");
    expect(problem?.location).toEqual({ providerName: null, index: null });
  });

  it("carries the provider that owns a broken raw body", () => {
    expect(modelsConfigProblem("{", "alpha")?.location).toEqual({ providerName: "alpha", index: null });
    expect(modelsConfigProblem("[]", "beta")?.location).toEqual({ providerName: "beta", index: null });
  });
});

describe("missingModelIdProblem", () => {
  it("is null when every model has an id", () => {
    expect(missingModelIdProblem(baseline)).toBeNull();
  });

  it("points at the provider and index of a blank id", () => {
    const config = withAddedModel(baseline, "beta");
    const problem = missingModelIdProblem(config.config);
    expect(problem?.reason).toBe("empty-model-id");
    expect(problem?.location).toEqual({ providerName: "beta", index: 1 });
  });

  it("treats a whitespace-only id as empty", () => {
    const config = withProvider(baseline, "gamma", { models: [{ id: "  " }] });
    expect(missingModelIdProblem(config)?.location).toEqual({ providerName: "gamma", index: 0 });
  });
});
