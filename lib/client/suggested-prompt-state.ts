import { decideSuggestedPromptTab } from "@/lib/shared/suggested-prompt";

export type SuggestedPromptRequestDecision =
  | { kind: "request"; sessionId: string }
  | { kind: "skip"; reason: "no-session" | "already-running" };

export interface SuggestedPromptRequestInput {
  sessionId: string | null;
  requestInFlight: boolean;
}

export function decideSuggestedPromptRequest(
  input: SuggestedPromptRequestInput,
): SuggestedPromptRequestDecision {
  if (!input.sessionId) return { kind: "skip", reason: "no-session" };
  if (input.requestInFlight) return { kind: "skip", reason: "already-running" };
  return { kind: "request", sessionId: input.sessionId };
}

export interface SuggestedPromptState {
  suggestion: string | null;
  inFlightTurn: number | null;
  turn: number;
}

export const INITIAL_SUGGESTED_PROMPT_STATE: SuggestedPromptState = {
  suggestion: null,
  inFlightTurn: null,
  turn: 0,
};

export type SuggestedPromptAction =
  | { type: "request_started" }
  | { type: "request_settled"; turn: number; suggestion: string }
  | { type: "turn_started" };

export function reduceSuggestedPrompt(
  state: SuggestedPromptState,
  action: SuggestedPromptAction,
): SuggestedPromptState {
  switch (action.type) {
    case "request_started":
      return state.inFlightTurn === null ? { ...state, inFlightTurn: state.turn } : state;
    case "turn_started":
      return { suggestion: null, inFlightTurn: state.inFlightTurn, turn: state.turn + 1 };
    case "request_settled": {
      const inFlightTurn = state.inFlightTurn === action.turn ? null : state.inFlightTurn;
      if (action.turn !== state.turn) return { ...state, inFlightTurn };
      const suggestion = action.suggestion.trim();
      return { suggestion: suggestion || null, inFlightTurn, turn: state.turn };
    }
  }
}

export interface SuggestedPromptPlaceholderInput {
  inputText: string;
  suggestion: string | null;
  fallback: string;
}

export function selectSuggestedPromptPlaceholder(input: SuggestedPromptPlaceholderInput): string {
  const decision = decideSuggestedPromptTab({
    inputText: input.inputText,
    suggestion: input.suggestion,
  });
  return decision.kind === "adopt" ? decision.text : input.fallback;
}
