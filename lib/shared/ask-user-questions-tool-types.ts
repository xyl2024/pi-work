export const ASK_USER_QUESTIONS_TOOL_NAME = "ask_user_questions";

export const ASK_USER_QUESTIONS_MAX_QUESTIONS = 5;

export const ASK_USER_QUESTIONS_MIN_QUESTIONS = 1;

export const ASK_USER_QUESTIONS_MAX_OPTIONS = 4;

export const ASK_USER_QUESTIONS_MIN_OPTIONS = 2;

export const ASK_USER_QUESTIONS_HEADER_MAX = 12;

export const ASK_USER_QUESTIONS_QUESTION_MAX = 500;

export const ASK_USER_QUESTIONS_DESCRIPTION_MAX = 200;

export const ASK_USER_QUESTIONS_REPLY_MAX = 4000;

export const ASK_USER_QUESTIONS_OTHER_LABEL = "Other";

export const ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK = `\
## Tool ask_user_questions guidelines
- Use ask_user_questions when you need a decision from the user before continuing.
- Each call can carry 1-5 questions; group related decisions in one call.
- Each question must have 2-4 options.
- Every question must mark at least one option as recommended: \`recommended: { reason: "..." }\`. A single-select question must mark exactly one; a multi-select question may mark several, each with its own reason. The tool returns an error when a question has no recommendation.
- Put the reason in the \`recommended\` field, not in the label. A "(Recommended)" label suffix is only a compatibility channel for models that don't know the field: it is stripped from the rendered label and still counts as a recommendation.
- A recommendation is a suggestion, not a selection: it is never preselected for the user.
- The user may cancel instead of answering, and may attach a free-text note. When they do, the note is a comment on the whole batch — not an answer to any question. Read it and adjust instead of treating the cancel as an interruption.
- Set multiSelect true when multiple options are valid.
- Questions are required by default; use required false for optional questions.
- An Other option is appended automatically; do not add one yourself.
- Do not call this tool from a scheduled task or when no user is available.
`;

export interface AskUserQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  required: boolean;
  options: AskUserQuestionOption[];
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
  recommended?: { reason: string };
}

export interface AskUserQuestionsParams {
  questions: AskUserQuestion[];
}

export interface AskUserQuestionAnswer {
  questionIndex: number;
  selectedLabels: string[];
  otherText: string | null;
}

export interface AskUserQuestionsDetails {
  answers: AskUserQuestionAnswer[];
  cancelled: boolean;
  reply?: string;
}

export interface AskUserQuestionsDecision {
  answers: AskUserQuestionAnswer[];
}

export interface AskUserQuestionsCancel {
  cancelled: true;
  message?: string;
}

export type UserInputResolution =
  | { kind: "answered"; answers: AskUserQuestionAnswer[] }
  | { kind: "cancelled" }
  | { kind: "replied"; message: string };

export type AskUserQuestionsRequestPayload = {
  toolCallId: string;
  questions: AskUserQuestion[];
  ts: number;
};

export function isOtherOptionLabel(label: string): boolean {
  return label === ASK_USER_QUESTIONS_OTHER_LABEL;
}

const RECOMMENDED_SUFFIX_RE = /[（(]\s*(?:recommended|推荐)\s*[)）]\s*$/i;

export function stripRecommendedSuffix(label: string): {
  label: string;
  stripped: boolean;
} {
  const match = RECOMMENDED_SUFFIX_RE.exec(label);
  if (!match) return { label, stripped: false };
  return { label: label.slice(0, match.index).trimEnd(), stripped: true };
}

export function optionIsRecommended(option: AskUserQuestionOption): boolean {
  return (
    option.recommended !== undefined || stripRecommendedSuffix(option.label).stripped
  );
}

export function resolveOptionRecommendation(option: AskUserQuestionOption): {
  label: string;
  recommended: boolean;
  reason: string | null;
} {
  const { label, stripped } = stripRecommendedSuffix(option.label);
  return {
    label,
    recommended: option.recommended !== undefined || stripped,
    reason: option.recommended?.reason ?? null,
  };
}

export function validateAskUserQuestions(
  params: AskUserQuestionsParams,
): string | null {
  if (!Array.isArray(params.questions)) return "questions must be an array";
  if (
    params.questions.length < ASK_USER_QUESTIONS_MIN_QUESTIONS ||
    params.questions.length > ASK_USER_QUESTIONS_MAX_QUESTIONS
  ) {
    return `questions must have ${ASK_USER_QUESTIONS_MIN_QUESTIONS}-${ASK_USER_QUESTIONS_MAX_QUESTIONS} items, got ${params.questions.length}`;
  }
  for (let i = 0; i < params.questions.length; i++) {
    const q = params.questions[i];
    if (typeof q.question !== "string" || q.question.length === 0) {
      return `questions[${i}].question must be a non-empty string`;
    }
    if (q.question.length > ASK_USER_QUESTIONS_QUESTION_MAX) {
      return `questions[${i}].question exceeds ${ASK_USER_QUESTIONS_QUESTION_MAX} chars`;
    }
    if (typeof q.header !== "string" || q.header.length === 0) {
      return `questions[${i}].header must be a non-empty string`;
    }
    if (q.header.length > ASK_USER_QUESTIONS_HEADER_MAX) {
      return `questions[${i}].header exceeds ${ASK_USER_QUESTIONS_HEADER_MAX} chars`;
    }
    if (typeof q.multiSelect !== "boolean") {
      return `questions[${i}].multiSelect must be a boolean`;
    }
    if (typeof q.required !== "boolean") {
      return `questions[${i}].required must be a boolean`;
    }
    if (!Array.isArray(q.options)) return `questions[${i}].options must be an array`;
    if (
      q.options.length < ASK_USER_QUESTIONS_MIN_OPTIONS ||
      q.options.length > ASK_USER_QUESTIONS_MAX_OPTIONS
    ) {
      return `questions[${i}].options must have ${ASK_USER_QUESTIONS_MIN_OPTIONS}-${ASK_USER_QUESTIONS_MAX_OPTIONS} items, got ${q.options.length}`;
    }
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
      if (typeof o.label !== "string" || o.label.length === 0) {
        return `questions[${i}].options[${j}].label must be a non-empty string`;
      }
      if (typeof o.description !== "string") {
        return `questions[${i}].options[${j}].description must be a string`;
      }
      if (o.description.length > ASK_USER_QUESTIONS_DESCRIPTION_MAX) {
        return `questions[${i}].options[${j}].description exceeds ${ASK_USER_QUESTIONS_DESCRIPTION_MAX} chars`;
      }
      if (o.recommended !== undefined) {
        if (
          typeof o.recommended !== "object" ||
          o.recommended === null ||
          typeof o.recommended.reason !== "string"
        ) {
          return `questions[${i}].options[${j}].recommended must be an object with a string reason`;
        }
        if (o.recommended.reason.length > ASK_USER_QUESTIONS_DESCRIPTION_MAX) {
          return `questions[${i}].options[${j}].recommended.reason exceeds ${ASK_USER_QUESTIONS_DESCRIPTION_MAX} chars`;
        }
      }
    }

    const recommendedCount = q.options.filter(optionIsRecommended).length;
    if (q.multiSelect) {
      if (recommendedCount === 0) {
        return `questions[${i}] must mark at least one option as recommended (add \`recommended: { reason: "..." }\` to the option(s) you suggest)`;
      }
    } else if (recommendedCount !== 1) {
      return `questions[${i}] must mark exactly one option as recommended for a single-select question (found ${recommendedCount})`;
    }
  }
  return null;
}

export function hasUnansweredRequired(
  questions: readonly AskUserQuestion[],
  answers: readonly AskUserQuestionAnswer[],
): boolean {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.required) continue;
    const a = answers[i];
    if (!a) return true;
    if (a.selectedLabels.length === 0) return true;
    const hasOther = a.selectedLabels.some(isOtherOptionLabel);
    if (hasOther && (a.otherText === null || a.otherText.trim().length === 0)) {
      return true;
    }
  }
  return false;
}

export function isQuestionAnswered(
  answer: AskUserQuestionAnswer | undefined,
): boolean {
  if (!answer || answer.selectedLabels.length === 0) return false;
  const hasOther = answer.selectedLabels.some(isOtherOptionLabel);
  if (hasOther && (answer.otherText ?? "").trim().length === 0) return false;
  return true;
}

function formatAnswersForAgent(
  questions: readonly AskUserQuestion[],
  answers: readonly AskUserQuestionAnswer[],
): string {
  const lines: string[] = ["User answered:"];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];
    if (!a) {
      lines.push(`  ${q.header}: (no answer)`);
      continue;
    }
    if (a.selectedLabels.length === 0) {
      lines.push(`  ${q.header}: (skipped)`);
      continue;
    }
    const labelsFmt: string[] = [];
    for (const lbl of a.selectedLabels) {
      if (isOtherOptionLabel(lbl)) {
        labelsFmt.push(`Other: "${a.otherText ?? ""}"`);
      } else {
        labelsFmt.push(lbl);
      }
    }
    const suffix = q.multiSelect && a.selectedLabels.length > 1 ? " (multi-select)" : "";
    lines.push(`  ${q.header}: ${labelsFmt.join(", ")}${suffix}`);
  }
  return lines.join("\n");
}

export function userInputToolResult(
  questions: readonly AskUserQuestion[],
  resolution: UserInputResolution,
): { text: string; details: AskUserQuestionsDetails } {
  if (resolution.kind === "cancelled") {
    return {
      text: "User cancelled the question.",
      details: { answers: [], cancelled: true },
    };
  }
  if (resolution.kind === "replied") {
    return {
      text:
        `User did not answer any of the questions. ` +
        `The user replied with this note instead: "${resolution.message}"`,
      details: { answers: [], cancelled: true, reply: resolution.message },
    };
  }
  return {
    text: formatAnswersForAgent(questions, resolution.answers),
    details: { answers: resolution.answers, cancelled: false },
  };
}