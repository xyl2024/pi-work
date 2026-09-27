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

/**
 * Whole-block system-prompt contribution for `ask_user_questions`.
 *
 * This is the single source of truth: the server tool re-exports it (it is
 * injected via `appendSystemPromptOverride` when the tool is in the session's
 * tool set) and the Tool Market catalog references the same constant, so the
 * two can no longer drift apart. It lives here — in a module that imports no
 * pi SDK and no Node module — so the text the agent reads is testable without
 * the SDK (ADR-0003 rule 3).
 */
export const ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK = `\
## Tool ask_user_questions guidelines
- Use ask_user_questions when you need a decision from the user before continuing.
- Each call can carry 1-5 questions; group related decisions in one call.
- Each question must have 2-4 options.
- Every question must mark at least one option as recommended: \`recommended: { reason: "..." }\`. A single-select question must mark exactly one; a multi-select question may mark several, each with its own reason. The tool returns an error when a question has no recommendation.
- Put the reason in the \`recommended\` field, not in the label. A "(Recommended)" label suffix is only a compatibility channel for models that don't know the field: it is stripped from the rendered label and still counts as a recommendation.
- A recommendation is a suggestion, not a selection: it is never preselected for the user.
- Set multiSelect true when multiple options are valid.
- Questions are required by default; use required false for optional questions.
- An Other option is appended automatically; do not add one yourself.
- Do not call this tool from a scheduled task or when no user is available.
`;

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
  /** When present, this is the option the agent suggests, and `reason` says
   *  why. Exactly one option for a single-select question; at least one for a
   *  multi-select question — `validateAskUserQuestions` enforces that, and a
   *  recognized label suffix like "(Recommended)" counts as a recommendation
   *  too (the zero-shot Claude Code shape). Recommendations affect rendering
   *  only: they never enter `selectedLabels` and never mark a question
   *  answered. */
  recommended?: { reason: string };
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

/** Result envelope returned to the model. Deferred state-style shape. */
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

/** Public shape of the Promise `requestUserInput` resolves with: the user's
 *  answers, or a cancel. Lives here (not in the server-only tool file) so the
 *  interaction-gate module can speak it without importing the pi SDK. */
export type UserInputResolution =
  | { kind: "answered"; answers: AskUserQuestionAnswer[] }
  | { kind: "cancelled" };

/** Server-side payload attached to the `ask_user_questions_request` SSE event.
 *
 * A `type` alias, not an `interface`, on purpose: the session-event protocol
 * intersects it, and an interface intersection carries no implicit index
 * signature — which would make the protocol unassignable to the loose reader
 * types other server modules declare for the same event stream. */
export type AskUserQuestionsRequestPayload = {
  toolCallId: string;
  questions: AskUserQuestion[];
  /** Epoch ms when the request was emitted. Useful for ordering and for
   *  showing "asked N seconds ago" in the UI. */
  ts: number;
};

/** Detect whether the given option label triggers free-text mode. */
export function isOtherOptionLabel(label: string): boolean {
  return label === ASK_USER_QUESTIONS_OTHER_LABEL;
}

/** Recognized "(Recommended)" / "（推荐）" label suffixes: half- or
 *  full-width parentheses, ASCII case-insensitive. Anchored at the end, so an
 *  ordinary word like "推荐算法" or "不推荐" is never touched — and no fuzzy
 *  matching, because those words are common in Chinese labels. */
const RECOMMENDED_SUFFIX_RE = /[（(]\s*(?:recommended|推荐)\s*[)）]\s*$/i;

/** Detect and strip a Claude-Code-style recommendation suffix from a label.
 *  Returns the cleaned label and whether a suffix was found. Pure — the UI
 *  calls it on every render. */
export function stripRecommendedSuffix(label: string): {
  label: string;
  stripped: boolean;
} {
  const match = RECOMMENDED_SUFFIX_RE.exec(label);
  if (!match) return { label, stripped: false };
  return { label: label.slice(0, match.index).trimEnd(), stripped: true };
}

/** True when the option is the agent's suggestion — either structurally
 *  (the `recommended` field) or via a recognized label suffix. Used by
 *  validation, so a zero-shot suffix-only call satisfies "every question
 *  needs a recommendation" without a retry. */
export function optionIsRecommended(option: AskUserQuestionOption): boolean {
  return (
    option.recommended !== undefined || stripRecommendedSuffix(option.label).stripped
  );
}

/** What the UI renders for one option: the label with any recommendation
 *  suffix stripped, whether it is recommended, and the reason when the agent
 *  gave one (a suffix-only recommendation has none). The `recommended` field
 *  wins: when it is present the suffix is ignored as a signal, but it is
 *  still stripped from the label so "推荐 (Recommended)" is never shown. */
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

    // "Every question names a recommendation" is a hard constraint the schema
    // cannot express (it cannot say "at least one item in this array carries
    // this optional field"). The model gets a tool error it can fix in the
    // same turn. A recognized label suffix counts, so a zero-shot Claude Code
    // call (no `recommended` field, "(Recommended)" in the label) passes.
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