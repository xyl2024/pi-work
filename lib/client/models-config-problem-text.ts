import type { ModelsConfigProblem } from "@/lib/shared/models-config-draft";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The user-facing text for the one blocking problem, in one place — the fixed
 * save bar and the raw editor must say the same thing about the same text.
 */
export function modelsConfigProblemText(problem: ModelsConfigProblem | null, t: Translate): string | null {
  if (!problem) return null;
  if (problem.reason === "provider-name-conflict") return t("Name already exists");
  if (problem.reason === "provider-name") return t("Provider name cannot be empty");
  if (problem.reason === "not-object") return t("Raw JSON must be an object");
  return t("Invalid JSON: {error}", { error: problem.message });
}
