import { describe, expect, it } from "vitest";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import {
  missingModelIdProblem,
  modelsConfigProblem,
  modelsConfigProblemAt,
} from "@/lib/shared/models-config-draft";

function translate(key: string, params?: Record<string, string | number>): string {
  if (!params) return key;
  return key.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

describe("models config problem text", () => {
  it("names the provider when its display name is blank", () => {
    const problem = modelsConfigProblemAt("provider-name", "Provider name cannot be empty", {
      providerName: "alpha",
      index: null,
    });

    expect(modelsConfigProblemText(problem, translate)).toBe('Provider "alpha" has an empty name');
  });

  it("names the provider whose display name collides", () => {
    const problem = modelsConfigProblemAt("provider-name-conflict", "Name already exists", {
      providerName: "beta",
      index: null,
    });

    expect(modelsConfigProblemText(problem, translate)).toBe('Another provider already uses the name "beta"');
  });

  it("names the provider holding the model without an id", () => {
    const problem = missingModelIdProblem({ providers: { alpha: { api: "openai-completions", models: [{ id: "" }] } } });

    expect(modelsConfigProblemText(problem, translate)).toBe('Provider "alpha" has a model without an ID');
  });

  it("names the provider whose raw JSON is not an object", () => {
    const problem = modelsConfigProblem("[1, 2]", "alpha");

    expect(modelsConfigProblemText(problem, translate)).toBe('Provider "alpha" raw JSON must be an object');
  });

  it("names the provider holding the raw JSON syntax error", () => {
    const problem = modelsConfigProblem("{", "alpha");

    expect(modelsConfigProblemText(problem, translate)).toContain('Provider "alpha" raw JSON is invalid: ');
  });

  it("falls back to the location when no display name is given", () => {
    const problem = modelsConfigProblemAt("empty-model-id", "Model ID cannot be empty", {
      providerName: "gamma",
      index: 0,
    });

    expect(modelsConfigProblemText(problem, translate)).toContain('"gamma"');
  });
});
