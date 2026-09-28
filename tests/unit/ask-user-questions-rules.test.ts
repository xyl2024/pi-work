import { describe, expect, it } from "vitest";
import {
  hasUnansweredRequired,
  optionIsRecommended,
  resolveOptionRecommendation,
  stripRecommendedSuffix,
  userInputToolResult,
  validateAskUserQuestions,
  type AskUserQuestion,
  type AskUserQuestionsParams,
} from "@/lib/shared/ask-user-questions-tool-types";

/**
 * Tests for the ask_user_questions rules that live in the shared, SDK-free
 * module: the "every question needs a recommendation" validation, the
 * Claude-Code suffix normalization, and the resolution → tool-result mapping.
 * They assert only what the module hands back (ADR-0003 rule 3).
 */

/** A minimal valid single-select question with one recommended option. */
const question = (over: Partial<AskUserQuestion> = {}): AskUserQuestion => ({
  question: "Where should the new file go?",
  header: "Location",
  multiSelect: false,
  required: true,
  options: [
    {
      label: "src",
      description: "Next to the rest of the source.",
      recommended: { reason: "Keeps it discoverable." },
    },
    { label: "tests", description: "In the test tree." },
  ],
  ...over,
});

const params = (questions: AskUserQuestion[]): AskUserQuestionsParams => ({ questions });
const validate = (questions: AskUserQuestion[]) => validateAskUserQuestions(params(questions));

describe("recommended validation", () => {
  it("accepts a single-select question with exactly one recommended option", () => {
    expect(validate([question()])).toBeNull();
  });

  it("rejects a question that recommends nothing", () => {
    const q = question({
      options: [
        { label: "src", description: "Next to the source." },
        { label: "tests", description: "In the test tree." },
      ],
    });
    expect(validate([q])).toContain("recommended");
  });

  it("rejects two recommendations on a single-select question", () => {
    const q = question({
      options: [
        { label: "src", description: "a", recommended: { reason: "x" } },
        { label: "tests", description: "b", recommended: { reason: "y" } },
      ],
    });
    expect(validate([q])).toContain("exactly one");
  });

  it("accepts several recommendations on a multi-select question", () => {
    const q = question({
      multiSelect: true,
      options: [
        { label: "src", description: "a", recommended: { reason: "x" } },
        { label: "tests", description: "b", recommended: { reason: "y" } },
      ],
    });
    expect(validate([q])).toBeNull();
  });

  it("rejects a recommendation reason over the description limit", () => {
    const q = question({
      options: [
        {
          label: "src",
          description: "a",
          recommended: { reason: "x".repeat(201) },
        },
        { label: "tests", description: "b" },
      ],
    });
    expect(validate([q])).toContain("recommended.reason");
  });

  it("counts a (Recommended) label suffix as the question's recommendation", () => {
    const q = question({
      options: [
        { label: "src (Recommended)", description: "a" },
        { label: "tests", description: "b" },
      ],
    });
    expect(validate([q])).toBeNull();
  });
});

describe("recommendation suffix normalization", () => {
  it.each([
    ["src (Recommended)"],
    ["src (recommended)"],
    ["src (RECOMMENDED)"],
    ["src （推荐）"],
    ["src (推荐)"],
    ["src （Recommended）"],
  ])("strips the suffix from %s", (label) => {
    expect(stripRecommendedSuffix(label)).toEqual({ label: "src", stripped: true });
  });

  it("leaves ordinary labels alone", () => {
    expect(stripRecommendedSuffix("推荐算法")).toEqual({
      label: "推荐算法",
      stripped: false,
    });
    expect(stripRecommendedSuffix("不推荐")).toEqual({
      label: "不推荐",
      stripped: false,
    });
    expect(stripRecommendedSuffix("src")).toEqual({ label: "src", stripped: false });
  });

  it("lets the recommended field win, but still strips the suffix", () => {
    expect(
      resolveOptionRecommendation({
        label: "src (Recommended)",
        description: "a",
        recommended: { reason: "Fast." },
      }),
    ).toEqual({ label: "src", recommended: true, reason: "Fast." });
  });

  it("lights up a suffix-only recommendation with no reason", () => {
    expect(
      resolveOptionRecommendation({ label: "src (Recommended)", description: "a" }),
    ).toEqual({ label: "src", recommended: true, reason: null });
  });

  it("does not fold a recommendation into the answer", () => {
    const q = question();
    expect(optionIsRecommended(q.options[0])).toBe(true);
    expect(optionIsRecommended(q.options[1])).toBe(false);
    // Recommending an option selects nothing: the question is still unanswered.
    expect(
      hasUnansweredRequired(
        [q],
        [{ questionIndex: 0, selectedLabels: [], otherText: null }],
      ),
    ).toBe(true);
  });
});

describe("resolution → tool result", () => {
  const questions = [question()];

  it("keeps the plain-cancel wording and details exactly as they were", () => {
    const result = userInputToolResult(questions, { kind: "cancelled" });
    expect(result.text).toBe("User cancelled the question.");
    expect(result.details).toEqual({ answers: [], cancelled: true });
    expect(result.details.reply).toBeUndefined();
  });

  it("turns a replied resolution into 'no answers, but a note'", () => {
    const result = userInputToolResult(questions, {
      kind: "replied",
      message: "Neither fits; use a queue instead.",
    });
    expect(result.text).toContain("did not answer");
    expect(result.text).toContain("The user replied with this note instead");
    expect(result.text).toContain("Neither fits; use a queue instead.");
    expect(result.details).toEqual({
      answers: [],
      cancelled: true,
      reply: "Neither fits; use a queue instead.",
    });
  });

  it("formats answers unchanged", () => {
    const answers = [{ questionIndex: 0, selectedLabels: ["src"], otherText: null }];
    const result = userInputToolResult(questions, { kind: "answered", answers });
    expect(result.details).toEqual({ answers, cancelled: false });
    expect(result.text).toContain("Location: src");
  });

  it("never puts a recommendation into the answer", () => {
    // The user picked the non-recommended option: the recommended label ("src")
    // must not leak into what the agent reads as the user's choice.
    const answers = [{ questionIndex: 0, selectedLabels: ["tests"], otherText: null }];
    const result = userInputToolResult(questions, { kind: "answered", answers });
    expect(result.details.answers[0].selectedLabels).toEqual(["tests"]);
    expect(result.text).toContain("Location: tests");
    expect(result.text).not.toContain("src");
  });
});
