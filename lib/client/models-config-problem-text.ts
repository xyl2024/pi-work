import type { ModelsConfigProblem } from "@/lib/shared/models-config-draft";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function modelsConfigProblemText(
  problem: ModelsConfigProblem | null,
  t: Translate,
  name?: string,
): string | null {
  if (!problem) return null;
  const providerName = name ?? problem.location.providerName ?? "";
  const params = { name: providerName };
  if (problem.reason === "provider-name-conflict") {
    return t('Another provider already uses the name "{name}"', params);
  }
  if (problem.reason === "provider-name") return t('Provider "{name}" has an empty name', params);
  if (problem.reason === "empty-model-id") return t('Provider "{name}" has a model without an ID', params);
  if (problem.reason === "not-object") return t('Provider "{name}" raw JSON must be an object', params);
  return t('Provider "{name}" raw JSON is invalid: {error}', { ...params, error: problem.message });
}
