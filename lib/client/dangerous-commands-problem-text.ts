import type { DangerousRuleProblem } from "@/lib/shared/dangerous-commands-draft";

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
  const rule = label ?? t("Rule {n}", { n: problem.index + 1 });
  switch (problem.kind) {
    case "empty-name":
      return { message: t("{rule}: name is required.", { rule }) };
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
