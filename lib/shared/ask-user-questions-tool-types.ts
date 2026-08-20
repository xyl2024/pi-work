/**
 * Client-safe constants, types, and pure helpers for the `ask_user_questions`
 * tool.
 *
 * This file MUST NOT import `@earendil-works/pi-coding-agent` or any
 * server-only Node module — it's imported by client components
 * (`components/AskUserQuestionsPanel.tsx`,
 * `hooks/askUserQuestionsStore.ts`) to match the tool name and types
 * without pulling server-only code into the browser bundle.
 *
 * Schema mirrors Anthropic's Claude Code `AskUserQuestion` tool so LLMs that
 * already know that shape can use this tool zero-shot. One small extension:
 * each question may carry `required: boolean` (default true when omitted —
 * the server normalizes an omitted field to true) — when true, the user
 * cannot submit without selecting at least one option (and, if the "Other"
 * option is selected, typing non-empty text).
 */

export const ASK_USER_QUESTIONS_TOOL_NAME = "ask_user_questions";

/** Maximum questions allowed per single tool call. */
export const ASK_USER_QUESTIONS_MAX_QUESTIONS = 5;

/** Minimum questions allowed per single tool call (schema enforces ≥1). */
export const ASK_USER_QUESTIONS_MIN_QUESTIONS = 1;

/** Maximum options allowed per question. */
export const ASK_USER_QUESTIONS_MAX_OPTIONS = 4;

/** Minimum options allowed per question (schema enforces ≥2). */
export const ASK_USER_QUESTIONS_MIN_OPTIONS = 2;

/** Max characters for a question's short `header` chip label. */
export const ASK_USER_QUESTIONS_HEADER_MAX = 12;

/** Max characters for a question's full `question` text. */
export const ASK_USER_QUESTIONS_QUESTION_MAX = 500;

/** Max characters for an option's description. */
export const ASK_USER_QUESTIONS_DESCRIPTION_MAX = 200;

/** Exact label that, when present in an option, enables free-text input. */
export const ASK_USER_QUESTIONS_OTHER_LABEL = "Other";

/** Single question as authored by the agent. */
export interface AskUserQuestion {
  /** Long-form question text shown to the user. */
  question: string;
  /** Short chip label (1-12 chars); also used to reference the question in
   *  the agent-visible answer summary. */
  header: string;
  /** When true, the user may select multiple options. Default false. */
  multiSelect: boolean;
  /** When true, the user cannot submit without at least one selected
   *  option (and non-empty text if "Other" is selected). The schema field
   *  is optional; omitted means required (normalized to true server-side). */
  required: boolean;
  /** 2-4 options to present. */
  options: AskUserQuestionOption[];
}

/** Single option as authored by the agent. */
export interface AskUserQuestionOption {
  /** 1-5 word label shown as the choice. Exact match "Other" enables
   *  free-text input mode. */
  label: string;
  /** Short explanation shown beneath the label. */
  description: string;
}

/** Full payload the agent passes to the tool. */
export interface AskUserQuestionsParams {
  questions: AskUserQuestion[];
}

/** A single answer recorded for one question. */
export interface AskUserQuestionAnswer {
  /** Index into the original `questions[]` array. */
  questionIndex: number;
  /** Selected option labels, in selection order. Empty if the user skipped
   *  a non-required question. */
  selectedLabels: string[];
  /** Free-text typed when one of the selectedLabels is "Other". `null` when
   *  the user picked only pre-defined options. */
  otherText: string | null;
}

/** Result envelope returned to the model. Mirrors `agent_todo`'s shape. */
export interface AskUserQuestionsDetails {
  /** Per-question answers, same order as `questions[]`. */
  answers: AskUserQuestionAnswer[];
  /** True when the user clicked Cancel — `answers` is empty. */
  cancelled: boolean;
}

/** Wire shape sent from client to server when the user submits. */
export interface AskUserQuestionsDecision {
  /** Per-question answers as submitted by the user. */
  answers: AskUserQuestionAnswer[];
}

/** Wire shape sent from client to server when the user cancels. */
export interface AskUserQuestionsCancel {
  cancelled: true;
}

/** Server-side payload attached to the `ask_user_questions_request` SSE event. */
export interface AskUserQuestionsRequestPayload {
  toolCallId: string;
  questions: AskUserQuestion[];
  /** Epoch ms when the request was emitted. Useful for ordering and for
   *  showing "asked N seconds ago" in the UI. */
  ts: number;
}

/** Detect whether the given option label triggers free-text mode. */
export function isOtherOptionLabel(label: string): boolean {
  return label === ASK_USER_QUESTIONS_OTHER_LABEL;
}

/** Validate that a question object satisfies the schema bounds. Pure helper
 *  used by both the server-side tool wrapper (after schema validation
 *  passes, as a defense-in-depth check) and the client (to flag malformed
 *  server events gracefully). Returns an error message or null. */
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
    }
  }
  return null;
}

/** True when at least one question in the batch is still unanswered (no
 *  selectedLabels). Used to gate the Submit button. */
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
    // Required + "Other" selected → text must be non-empty.
    const hasOther = a.selectedLabels.some(isOtherOptionLabel);
    if (hasOther && (a.otherText === null || a.otherText.trim().length === 0)) {
      return true;
    }
  }
  return false;
}

/** True when the user has provided a real answer for one question (not
 *  just toggled an option). Specifically: at least one label selected,
 *  and if "Other" is among them, the typed text must be non-empty
 *  (whitespace-only counts as empty so stray spaces don't pass).
 *
 *  Used by the tab "answered" indicator dot — having "Other" ticked with
 *  no text should NOT light up the dot, because from the user's POV the
 *  question isn't actually answered yet. Mirrors the same logic that
 *  `hasUnansweredRequired` enforces for required questions. */
export function isQuestionAnswered(
  answer: AskUserQuestionAnswer | undefined,
): boolean {
  if (!answer || answer.selectedLabels.length === 0) return false;
  const hasOther = answer.selectedLabels.some(isOtherOptionLabel);
  if (hasOther && (answer.otherText ?? "").trim().length === 0) return false;
  return true;
}