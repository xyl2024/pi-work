import {
  DANGEROUS_RULE_TIMEOUT_MAX_MS,
  DANGEROUS_RULE_TIMEOUT_MIN_MS,
  type DangerousRuleProblem,
} from "@/lib/shared/dangerous-commands-draft";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function dangerousRuleProblemText(
  problem: DangerousRuleProblem,
  t: Translate,
  label?: string,
): { message: string; detail?: string } {
  if (problem.kind === "timeout") {
    return {
      message: t("Confirmation timeout must be a number between {min} and {max} ms.", {
        min: DANGEROUS_RULE_TIMEOUT_MIN_MS,
        max: DANGEROUS_RULE_TIMEOUT_MAX_MS,
      }),
    };
  }

  const rule = label ?? t("Rule {n}", { n: problem.index + 1 });
  switch (problem.kind) {
    case "empty-name":
      return { message: t("{rule}: name is required.", { rule }) };
    case "duplicate-name":
      return {
        message:
          problem.conflictIndex === undefined
            ? t('{rule}: the name "{name}" is already used by another rule.', {
                rule,
                name: problem.name ?? "",
              })
            : t('{rule}: the name "{name}" is already used by rule {n}.', {
                rule,
                name: problem.name ?? "",
                n: problem.conflictIndex + 1,
              }),
      };
    case "builtin-name":
      return {
        message: t('{rule}: the name "{name}" is used by a built-in rule.', {
          rule,
          name: problem.name ?? "",
        }),
      };
    case "empty-pattern":
      return {
        message: t("{rule}: the pattern is required — an empty pattern matches every command.", {
          rule,
        }),
      };
    case "invalid-pattern":
      return {
        message: t("{rule}: the pattern does not compile.", { rule }),
        ...(problem.error ? { detail: problem.error } : {}),
      };
  }
}
