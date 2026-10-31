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

export interface SuggestedPromptInFlight {
  sessionId: string;
  turn: number;
}

export interface SuggestedPromptState {
  sessionId: string | null;
  suggestion: string | null;
  inFlight: SuggestedPromptInFlight | null;
  turn: number;
}

export const INITIAL_SUGGESTED_PROMPT_STATE: SuggestedPromptState = {
  sessionId: null,
  suggestion: null,
  inFlight: null,
  turn: 0,
};

export type SuggestedPromptAction =
  | { type: "session_changed"; sessionId: string | null }
  | { type: "request_started"; sessionId: string }
  | { type: "request_settled"; sessionId: string; turn: number; suggestion: string }
  | { type: "turn_started" };

export function reduceSuggestedPrompt(
  state: SuggestedPromptState,
  action: SuggestedPromptAction,
): SuggestedPromptState {
  switch (action.type) {
    case "session_changed":
      if (action.sessionId === state.sessionId) return state;
      return { sessionId: action.sessionId, suggestion: null, inFlight: null, turn: 0 };
    case "request_started":
      return state.inFlight === null
        ? { ...state, inFlight: { sessionId: action.sessionId, turn: state.turn } }
        : state;
    case "turn_started":
      return { ...state, suggestion: null, turn: state.turn + 1 };
    case "request_settled": {
      const ownsInFlight =
        state.inFlight !== null &&
        state.inFlight.sessionId === action.sessionId &&
        state.inFlight.turn === action.turn;
      const inFlight = ownsInFlight ? null : state.inFlight;
      if (action.sessionId !== state.sessionId || action.turn !== state.turn) {
        return { ...state, inFlight };
      }
      const suggestion = action.suggestion.trim();
      return { ...state, suggestion: suggestion || null, inFlight };
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
