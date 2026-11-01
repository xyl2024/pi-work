"use client";

import { useCallback, useEffect, useState } from "react";
import {
  decideSuggestedPromptFetch,
  selectSuggestionText,
  type SuggestedPromptLeafText,
} from "@/lib/client/suggested-prompt-state";

export interface SuggestedPromptPush {
  leafId: string;
  suggestion: string;
}

export interface UseSuggestedPromptOptions {
  sessionId: string | null;
  leafId: string | null;
  busy: boolean;
}

export interface UseSuggestedPromptResult {
  suggestion: string | null;
  handleTurnStarted: () => void;
  handleSuggestionPushed: (push: SuggestedPromptPush) => void;
}

async function readSuggestion(
  sessionId: string,
  leafId: string,
  method: "GET" | "POST",
): Promise<string> {
  const query = method === "GET" ? `?leafId=${encodeURIComponent(leafId)}` : "";
  const init: RequestInit =
    method === "GET"
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leafId }),
        };
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/suggest${query}`,
      init,
    );
    if (!response.ok) return "";
    const body = (await response.json().catch(() => ({}))) as { suggestion?: unknown };
    return typeof body.suggestion === "string" ? body.suggestion : "";
  } catch {
    return "";
  }
}

async function fetchSuggestion(sessionId: string, leafId: string): Promise<string> {
  const cached = await readSuggestion(sessionId, leafId, "GET");
  if (cached) return cached;
  return readSuggestion(sessionId, leafId, "POST");
}

export function useSuggestedPrompt({
  sessionId,
  leafId,
  busy,
}: UseSuggestedPromptOptions): UseSuggestedPromptResult {
  const [fetched, setFetched] = useState<SuggestedPromptLeafText | null>(null);
  const [pushed, setPushed] = useState<SuggestedPromptLeafText | null>(null);
  const [suppressedLeafId, setSuppressedLeafId] = useState<string | null>(null);

  useEffect(() => {
    const decision = decideSuggestedPromptFetch({ sessionId, leafId, busy });
    if (decision.kind === "skip") {
      setFetched(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const text = await fetchSuggestion(decision.sessionId, decision.leafId);
      if (cancelled) return;
      setFetched(text ? { leafId: decision.leafId, text } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, leafId, busy]);

  const handleSuggestionPushed = useCallback((push: SuggestedPromptPush) => {
    if (!push.suggestion.trim()) return;
    setPushed({ leafId: push.leafId, text: push.suggestion });
  }, []);

  const handleTurnStarted = useCallback(() => {
    setSuppressedLeafId(leafId);
  }, [leafId]);

  const suggestion = selectSuggestionText({ leafId, fetched, pushed, suppressedLeafId });

  return { suggestion, handleTurnStarted, handleSuggestionPushed };
}
