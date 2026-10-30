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
  ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK,
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

const UNATTENDED_REFUSAL: Partial<Record<BuildToolOptions["source"], string>> = {
  scheduled:
    "ask_user_questions is unavailable in scheduled tasks (no user is available to answer). Provide the necessary context to the model directly instead.",
  subagent:
    "ask_user_questions is unavailable in a subagent session (no user is available to answer it). Decide from the task you were given, state the assumption you made, and continue.",
};

function errorEnvelope(message: string): { content: [{ type: "text"; text: string }]; details: AskUserQuestionsDetails } {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { answers: [], cancelled: true },
  };
}

interface BuildToolOptions {
  requestUserInput?: RequestUserInputFn;
  source: "user" | "scheduled" | "subagent";
}

function makeTool({ requestUserInput, source }: BuildToolOptions) {
  return defineTool<typeof AskUserQuestionsParamsSchema, AskUserQuestionsDetails>({
    name: ASK_USER_QUESTIONS_TOOL_NAME,
    label: "Ask User Questions",
    description:
      "Ask the user 1-5 multiple-choice questions and wait for their answers. Each question has 2-4 options with a short label and a longer description. Mark the option you suggest with `recommended: { reason: \"...\" }` — exactly one option on a single-select question, at least one on a multi-select question; the tool returns an error when a question has no recommendation. Set `multiSelect: true` to allow multiple selections. Questions are required by default; set `required: false` to let the user skip one. A free-text \"Other\" option is always appended automatically, so the user can always type a custom answer — do not add your own. The tool blocks until the user responds or cancels; the user may cancel with a free-text note, which is a comment on the whole batch rather than an answer. Do not call it from a context where no user is available (e.g. a scheduled task — the tool will return an error in that case).",
    parameters: AskUserQuestionsParamsSchema,
    executionMode: "sequential",
    promptSnippet: "Ask the user structured multiple-choice questions.",
    async execute(toolCallId, params, signal, _onUpdate, _ctx) { // eslint-disable-line @typescript-eslint/no-unused-vars -- intentionally unused SDK params
      if (!requestUserInput) {
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

      const unattended = UNATTENDED_REFUSAL[source];
      if (unattended) {
        log.info("ask_user_questions short-circuited for unattended session", {
          toolCallId,
          source,
        });
        return errorEnvelope(unattended);
      }

      const requestPromise = requestUserInput(toolCallId, questions);

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