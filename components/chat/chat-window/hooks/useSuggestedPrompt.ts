"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_SUGGESTED_PROMPT_STATE,
  decideSuggestedPromptRequest,
  reduceSuggestedPrompt,
  type SuggestedPromptAction,
  type SuggestedPromptState,
} from "@/lib/client/suggested-prompt-state";

export interface UseSuggestedPromptOptions {
  sessionId: string | null;
  leafId: string | null;
}

export interface UseSuggestedPromptResult {
  suggestion: string | null;
  handleAgentEnd: () => void;
  handleTurnStarted: () => void;
}

export function useSuggestedPrompt({
  sessionId,
  leafId,
}: UseSuggestedPromptOptions): UseSuggestedPromptResult {
  const stateRef = useRef<SuggestedPromptState>(INITIAL_SUGGESTED_PROMPT_STATE);
  const [state, setState] = useState<SuggestedPromptState>(stateRef.current);
  const sessionIdRef = useRef(sessionId);
  const leafIdRef = useRef(leafId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    leafIdRef.current = leafId;
  }, [sessionId, leafId]);

  const dispatch = useCallback((action: SuggestedPromptAction) => {
    stateRef.current = reduceSuggestedPrompt(stateRef.current, action);
    setState(stateRef.current);
  }, []);

  const handleAgentEnd = useCallback(() => {
    const decision = decideSuggestedPromptRequest({
      sessionId: sessionIdRef.current,
      requestInFlight: stateRef.current.inFlightTurn !== null,
    });
    if (decision.kind === "skip") return;

    const turn = stateRef.current.turn;
    dispatch({ type: "request_started" });
    void (async () => {
      let suggestion = "";
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(decision.sessionId)}/suggest`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(leafIdRef.current ? { leafId: leafIdRef.current } : {}),
          },
        );
        if (response.ok) {
          const body = (await response.json().catch(() => ({}))) as { suggestion?: unknown };
          if (typeof body.suggestion === "string") suggestion = body.suggestion;
        }
      } catch {
        suggestion = "";
      }
      dispatch({ type: "request_settled", turn, suggestion });
    })();
  }, [dispatch]);

  const handleTurnStarted = useCallback(() => {
    dispatch({ type: "turn_started" });
  }, [dispatch]);

  return { suggestion: state.suggestion, handleAgentEnd, handleTurnStarted };
}
