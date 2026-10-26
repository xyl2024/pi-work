import {
  DANGEROUS_RULE_TIMEOUT_MAX_MS,
  DANGEROUS_RULE_TIMEOUT_MIN_MS,
  type DangerousRuleProblem,
} from "@/lib/shared/dangerous-commands-draft";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The user-facing text for the one blocking draft problem, in one place — the
 * page and the rule editor must say the same thing about the same row.
 *
 * Same shape as `lib/client/models-config-problem-text.ts`: pure display
 * mapping, no React, so it lives in the client layer rather than next to the
 * components.
 *
 * The sentence around the row is translated; the compiler's own reason stays
 * as `detail` because it is data from the JavaScript engine, not copy.
 */
export function dangerousRuleProblemText(
  problem: DangerousRuleProblem,
  t: Translate,
  label?: string,
): { message: string; detail?: string } {
  // The page-level blocker has no row, so it is answered before the row label
  // is worked out.
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
      // Name the conflicting rule when the draft knows it: "already used" is
      // only actionable if the user can find the other one.
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
