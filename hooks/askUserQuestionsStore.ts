"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AskUserQuestion,
  AskUserQuestionsCancel,
  AskUserQuestionsDecision,
} from "@/lib/shared/ask-user-questions-tool-types";
import { isContentEqual } from "@/lib/client/shallowEqual";

export interface PendingAskUserQuestions {
  sessionId: string;
  toolCallId: string;
  questions: AskUserQuestion[];
  ts: number;
}

type State = Map<string, PendingAskUserQuestions>;

let state: State = new Map();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: State) {
  state = next;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

function getServerSnapshot(): State {
  return EMPTY;
}

const EMPTY: State = new Map();

export function useAllPendingAskUserQuestions(): readonly PendingAskUserQuestions[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return Array.from(s.values());
}

export function usePendingAskUserQuestions(
  sessionId: string | null,
): PendingAskUserQuestions | null {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!sessionId) return null;
  return s.get(sessionId) ?? null;
}

export function getPendingAskUserQuestions(
  sessionId: string,
): PendingAskUserQuestions | null {
  return state.get(sessionId) ?? null;
}

export function setPendingAskUserQuestions(
  sessionId: string,
  entry: Omit<PendingAskUserQuestions, "sessionId">,
): void {
  const fullEntry: PendingAskUserQuestions = { ...entry, sessionId };
  const cur = state.get(sessionId);
  if (
    cur &&
    cur.toolCallId === fullEntry.toolCallId &&
    isContentEqual(cur.questions, fullEntry.questions) &&
    cur.ts === fullEntry.ts
  ) {
    return;
  }
  const next = new Map(state);
  next.set(sessionId, fullEntry);
  setState(next);
}

export function clearPendingAskUserQuestions(sessionId: string): void {
  if (!state.has(sessionId)) return;
  const next = new Map(state);
  next.delete(sessionId);
  setState(next);
}

export function buildAskUserQuestionsCancel(message?: string): AskUserQuestionsCancel {
  const note = (message ?? "").trim();
  return note.length > 0 ? { cancelled: true, message: note } : { cancelled: true };
}

export function useAskUserQuestionsSubmit(): (
  sessionId: string,
  toolCallId: string,
  decision: AskUserQuestionsDecision | AskUserQuestionsCancel,
) => Promise<boolean> {
  return useCallback(
    async (sessionId, toolCallId, decision) => {
      const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ask_user_questions_decision",
          toolCallId,
          decision,
        }),
      });
      if (!res.ok) {
        clearPendingAskUserQuestions(sessionId);
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
      }
      return true;
    },
    [],
  );
}