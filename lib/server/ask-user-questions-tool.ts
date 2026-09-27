/**
 * `ask_user_questions` — custom Pi tool that lets the agent ask the user
 * structured multiple-choice questions and block until they answer.
 *
 * Flow per call:
 *   1. Agent invokes the tool with `{ questions: [...] }` (1-5 questions,
 *      each with 2-4 options). Schema mirrors Anthropic's Claude Code
 *      `AskUserQuestion` plus one extension field (`required`) per question.
 *   2. If the session was started by the scheduler (no human available to
 *      answer), the tool short-circuits with an error result — better than
 *      hanging the scheduled run until `AGENT_END_TIMEOUT_MS`.
 *   3. Otherwise the tool calls the closure-bound `requestUserInput(toolCallId, questions)`
 *      (set per-session by `startRpcSession`). That bridge emits an
 *      `ask_user_questions_request` SSE event and returns a Promise resolving
 *      with the user's answers (or `{cancelled:true}`).
 *   4. The Promise rejects on AbortSignal or on wrapper destroy; the tool
 *      converts either into a structured error result so the agent sees a
 *      meaningful message instead of a hang.
 *   5. The tool assembles the standard `{content, details}` envelope for pi.
 *
 * IMPORTANT: This file imports `@earendil-works/pi-coding-agent`, which
 * transitively pulls in server-only Node modules. Client code that needs
 * the tool name or types must import from
 * `./ask-user-questions-tool-types` instead.
 */

import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_QUESTIONS_TOOL_NAME,
  ASK_USER_QUESTIONS_MAX_QUESTIONS,
  ASK_USER_QUESTIONS_MIN_QUESTIONS,
  ASK_USER_QUESTIONS_MAX_OPTIONS,
  ASK_USER_QUESTIONS_MIN_OPTIONS,
  ASK_USER_QUESTIONS_HEADER_MAX,
  ASK_USER_QUESTIONS_QUESTION_MAX,
  ASK_USER_QUESTIONS_DESCRIPTION_MAX,
  ASK_USER_QUESTIONS_OTHER_LABEL,
  isOtherOptionLabel,
  userInputToolResult,
  validateAskUserQuestions,
  type AskUserQuestion,
  type AskUserQuestionAnswer,
  type AskUserQuestionsDetails,
  type UserInputResolution,
} from "../shared/ask-user-questions-tool-types";
import { createLogger } from "./logger";

export { ASK_USER_QUESTIONS_TOOL_NAME };
export type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionsDetails,
  UserInputResolution,
} from "../shared/ask-user-questions-tool-types";
export {
  ASK_USER_QUESTIONS_MAX_QUESTIONS,
  ASK_USER_QUESTIONS_MIN_QUESTIONS,
  ASK_USER_QUESTIONS_MAX_OPTIONS,
  ASK_USER_QUESTIONS_MIN_OPTIONS,
  ASK_USER_QUESTIONS_HEADER_MAX,
  ASK_USER_QUESTIONS_QUESTION_MAX,
  ASK_USER_QUESTIONS_DESCRIPTION_MAX,
  ASK_USER_QUESTIONS_OTHER_LABEL,
  ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK,
  isOtherOptionLabel,
  hasUnansweredRequired,
} from "../shared/ask-user-questions-tool-types";

const log = createLogger("ask-user-questions-tool");

const AskUserQuestionsParamsSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({
        description: `Long-form question text shown to the user. Max ${ASK_USER_QUESTIONS_QUESTION_MAX} chars.`,
        maxLength: ASK_USER_QUESTIONS_QUESTION_MAX,
        minLength: 1,
      }),
      header: Type.String({
        description: `Short chip label (1-${ASK_USER_QUESTIONS_HEADER_MAX} chars). Used to reference this question in the agent-visible answer summary.`,
        maxLength: ASK_USER_QUESTIONS_HEADER_MAX,
        minLength: 1,
      }),
      multiSelect: Type.Boolean({
        description: "Allow multiple selections. Default false.",
        default: false,
      }),
      // Optional on purpose: many LLMs omit `required` (it's an extension
      // beyond Claude Code's AskUserQuestion shape). Omitting it used to
      // fail schema validation; now it falls back to required: true below.
      required: Type.Optional(
        Type.Boolean({
          description: "User must answer this question to submit. Default true when omitted.",
        }),
      ),
      options: Type.Array(
        Type.Object({
          label: Type.String({
            description: `1-5 word label. Exact match "${ASK_USER_QUESTIONS_OTHER_LABEL}" enables free-text input mode.`,
            minLength: 1,
          }),
          description: Type.String({
            description: `Short explanation shown beneath the label. Max ${ASK_USER_QUESTIONS_DESCRIPTION_MAX} chars.`,
            maxLength: ASK_USER_QUESTIONS_DESCRIPTION_MAX,
          }),
          // Optional on purpose: "every question names a recommendation" is
          // enforced by validateAskUserQuestions, not by the schema — the
          // schema cannot say "at least one item in this array carries this
          // optional field". The error is a tool result the model can fix in
          // the same turn.
          recommended: Type.Optional(
            Type.Object(
              {
                reason: Type.String({
                  description: `Why you suggest this option. Max ${ASK_USER_QUESTIONS_DESCRIPTION_MAX} chars.`,
                  maxLength: ASK_USER_QUESTIONS_DESCRIPTION_MAX,
                }),
              },
              {
                description:
                  "Mark this option as the one you suggest. Every question needs at least one recommended option — exactly one for a single-select question, one or more for a multi-select question.",
              },
            ),
          ),
        }),
        {
          minItems: ASK_USER_QUESTIONS_MIN_OPTIONS,
          maxItems: ASK_USER_QUESTIONS_MAX_OPTIONS,
        },
      ),
    }),
    {
      minItems: ASK_USER_QUESTIONS_MIN_QUESTIONS,
      maxItems: ASK_USER_QUESTIONS_MAX_QUESTIONS,
    },
  ),
});

type AskUserQuestionsParamsType = Static<typeof AskUserQuestionsParamsSchema>;

/** Function the wrapper exposes to the tool to register a pending question
 *  and wait for the user's answer. Bound by `startRpcSession` per session. */
export type RequestUserInputFn = (
  toolCallId: string,
  questions: AskUserQuestion[],
) => Promise<UserInputResolution>;

function paramsToQuestions(params: AskUserQuestionsParamsType): AskUserQuestion[] {
  return params.questions.map((q) => ({
    question: q.question,
    header: q.header,
    multiSelect: q.multiSelect,
    required: q.required ?? true,
    options: q.options.map((o) => ({
      label: o.label,
      description: o.description,
      ...(o.recommended ? { recommended: { reason: o.recommended.reason } } : {}),
    })),
  }));
}

function errorEnvelope(message: string): { content: [{ type: "text"; text: string }]; details: AskUserQuestionsDetails } {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { answers: [], cancelled: true },
  };
}

interface BuildToolOptions {
  /** Closure-bound request bridge to the wrapper, set per-session by
   *  `startRpcSession`. If undefined, the tool behaves as if the session
   *  has no UI to route questions to (returns an error). */
  requestUserInput?: RequestUserInputFn;
  /** Whether this session was started by the scheduler. Scheduled runs
   *  short-circuit immediately because no human is available. */
  source: "user" | "scheduled" | "subagent";
}

// The system-prompt block (`ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK`) lives in
// the shared, SDK-free types module and is re-exported above: the server
// injects it via appendSystemPromptOverride when the tool is in the session's
// tool set, and the Tool Market catalog shows the very same text.

function makeTool({ requestUserInput, source }: BuildToolOptions) {
  return defineTool<typeof AskUserQuestionsParamsSchema, AskUserQuestionsDetails>({
    name: ASK_USER_QUESTIONS_TOOL_NAME,
    label: "Ask User Questions",
    description:
      "Ask the user 1-5 multiple-choice questions and wait for their answers. Each question has 2-4 options with a short label and a longer description. Mark the option you suggest with `recommended: { reason: \"...\" }` — exactly one option on a single-select question, at least one on a multi-select question; the tool returns an error when a question has no recommendation. Set `multiSelect: true` to allow multiple selections. Questions are required by default; set `required: false` to let the user skip one. A free-text \"Other\" option is always appended automatically, so the user can always type a custom answer — do not add your own. The tool blocks until the user responds or cancels; the user may cancel with a free-text note, which is a comment on the whole batch rather than an answer. Do not call it from a context where no user is available (e.g. a scheduled task — the tool will return an error in that case).",
    parameters: AskUserQuestionsParamsSchema,
    executionMode: "sequential",
    promptSnippet: "Ask the user structured multiple-choice questions.",
    // Guidelines moved to ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK — injected
    // via appendSystemPromptOverride, gated on the tool being loaded.
    async execute(toolCallId, params, signal, _onUpdate, _ctx) { // eslint-disable-line @typescript-eslint/no-unused-vars -- intentionally unused SDK params
      // `_onUpdate` and `_ctx` are part of the SDK execute() protocol
      // signature but unused here (this tool blocks on user input
      // rather than streaming partial updates, and pulls no model
      // context from `ctx`). The leading underscore is the project's
      // "intentionally unused" convention.
      if (!requestUserInput) {
        // No bridge — the session was started without binding
        // requestUserInput (defensive: should never happen in practice
        // because startRpcSession always passes one for user sessions).
        log.warn("ask_user_questions called without requestUserInput binding", {
          toolCallId,
          source,
        });
        return errorEnvelope(
          "ask_user_questions is unavailable in this session (no UI bridge).",
        );
      }

      const questions = paramsToQuestions(params);
      const validationError = validateAskUserQuestions({ questions });
      if (validationError) {
        return errorEnvelope(validationError);
      }

      // Scheduled sessions have no human to answer. Fail fast so the
      // scheduler run completes (with an error message for the agent)
      // instead of hanging until AGENT_END_TIMEOUT_MS.
      if (source === "scheduled") {
        log.info("ask_user_questions short-circuited for scheduled session", {
          toolCallId,
        });
        return errorEnvelope(
          "ask_user_questions is unavailable in scheduled tasks (no user is available to answer). Provide the necessary context to the model directly instead.",
        );
      }

      const requestPromise = requestUserInput(toolCallId, questions);

      // Honor the AbortSignal — if the agent is aborted (via `abort` command
      // or a downstream cancel) while we're waiting for the user, reject
      // the question so the tool returns promptly instead of hanging the
      // whole turn.
      const abortPromise = signal
        ? new Promise<UserInputResolution>((_, reject) => {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          })
        : null;

      let resolution: UserInputResolution;
      try {
        resolution = await (abortPromise
          ? Promise.race([requestPromise, abortPromise])
          : requestPromise);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("ask_user_questions interrupted", { toolCallId, message });
        return errorEnvelope(`Question interrupted: ${message}`);
      }

      // Both non-answered kinds (plain cancel and a cancel carrying a note)
      // leave the questions unanswered; the resolution-to-result mapping owns
      // the wording and the details they persist.
      if (resolution.kind !== "answered") {
        log.info(
          resolution.kind === "replied"
            ? "ask_user_questions cancelled with a note"
            : "ask_user_questions cancelled by user",
          { toolCallId },
        );
        const result = userInputToolResult(questions, resolution);
        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
        };
      }

      const answers = resolution.answers;
      log.info("ask_user_questions answered", {
        toolCallId,
        questionCount: questions.length,
        answeredCount: answers.filter((a) => a.selectedLabels.length > 0).length,
      });

      // Defensive: filter out any answers referencing out-of-range indices
      // or unknown labels so a buggy / hostile client can't inject garbage.
      const sanitizedAnswers: AskUserQuestionAnswer[] = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const submitted = answers[i];
        if (!submitted) {
          sanitizedAnswers.push({
            questionIndex: i,
            selectedLabels: [],
            otherText: null,
          });
          continue;
        }
        const validLabels = new Set([
          ...q.options.map((o) => o.label),
          // The frontend always appends a fixed free-text "Other" option
          // to every question (regardless of what the agent authored), so
          // that label is always a valid selection. Without this the
          // sanitizer would strip it and the answer would come back as
          // "(skipped)" even though the user typed a real custom answer.
          ASK_USER_QUESTIONS_OTHER_LABEL,
        ]);
        const validSelected = submitted.selectedLabels.filter((l) => validLabels.has(l));
        const otherSelected = validSelected.some(isOtherOptionLabel);
        sanitizedAnswers.push({
          questionIndex: i,
          selectedLabels: validSelected,
          otherText: otherSelected
            ? (submitted.otherText ?? "").slice(0, 4000)
            : null,
        });
      }

      const result = userInputToolResult(questions, {
        kind: "answered",
        answers: sanitizedAnswers,
      });
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });
}

export function buildAskUserQuestionsTool(opts: BuildToolOptions) {
  return [makeTool(opts)];
}