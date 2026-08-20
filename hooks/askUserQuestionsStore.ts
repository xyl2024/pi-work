"use client";

/**
 * Module-scoped store for in-flight `ask_user_questions` requests.
 *
 * Each pending question lives here, keyed by `sessionId` (not toolCallId)
 * because at most one question can be pending per session at any time — the
 * agent's tool call blocks until the user answers, so a second invocation
 * only happens after the first resolves.
 *
 * Why a module-scoped store instead of component-local state:
 * - The sticky panel lives in ChatWindow (above ChatInput), but the sidebar
 *   dot indicator needs to read the same state from SessionSidebar. A
 *   module store avoids lifting state into AppShell or using a Context that
 *   would have to thread through every component that cares.
 * - SSE event handlers run inside useAgentSession; module state is the
 *   simplest way to bridge "server event in ChatWindow" → "panel that also
 *   lives in ChatWindow" without re-triggering useEffect chains.
 * - Like the other stores (sessionUiStore, toolCallStatsStore), state
 *   survives ChatWindow remounts on session switch.
 *
 * Reconnect handling: when the SSE stream reconnects, the server re-emits
 * every pending request (see app/api/agent/[id]/events/route.ts). The
 * frontend's SSE handler calls `setPending(...)` for each one; if the
 * sessionId already has a pending entry, the new request is treated as a
 * reconnect of the same question (same toolCallId) and the store entry is
 * preserved. If the toolCallId differs (which can happen if pi reassigned
 * the call after a retry), the new request wins.
 */

import { useCallback, useSyncExternalStore } from "react";
import type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionsCancel,
  AskUserQuestionsDecision,
} from "@/lib/shared/ask-user-questions-tool-types";
import { isContentEqual } from "@/lib/client/shallowEqual";

export interface PendingAskUserQuestions {
  /** Owning session id — required for sidebar dot lookups (the Map is
   *  keyed by sessionId, but consumers that iterate values need this). */
  sessionId: string;
  toolCallId: string;
  questions: AskUserQuestion[];
  /** Epoch ms when the request was emitted (server-supplied). */
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

/** All pending entries as a plain array snapshot. */
export function useAllPendingAskUserQuestions(): readonly PendingAskUserQuestions[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return Array.from(s.values());
}

/** The pending entry for one session, or null. Re-renders when the entry
 *  for this sessionId changes (added, removed, or content-equal replaced). */
export function usePendingAskUserQuestions(
  sessionId: string | null,
): PendingAskUserQuestions | null {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!sessionId) return null;
  return s.get(sessionId) ?? null;
}

/** Read-only check for the sidebar: does this session have a pending entry? */
export function useHasPendingAskUserQuestions(sessionId: string): boolean {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return s.has(sessionId);
}

/** Synchronous read of a session's pending entry (no subscription). Used by
 *  the panel's cleanup path to check whether a stale entry is still the one
 *  it submitted before clearing it. */
export function getPendingAskUserQuestions(
  sessionId: string,
): PendingAskUserQuestions | null {
  return state.get(sessionId) ?? null;
}

/** Server SSE handler → store. Idempotent on the (sessionId, toolCallId) pair:
 *  if the same pair comes through again (SSE reconnect re-emit), we keep
 *  the existing entry to avoid disturbing the panel mid-answer. */
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
    return; // no-op
  }
  const next = new Map(state);
  next.set(sessionId, fullEntry);
  setState(next);
}

/** Remove a session's pending entry. Called after the user submits/cancels
 *  (the wrapper's promise resolves, which removes the entry server-side —
 *  this call keeps the client store in sync). */
export function clearPendingAskUserQuestions(sessionId: string): void {
  if (!state.has(sessionId)) return;
  const next = new Map(state);
  next.delete(sessionId);
  setState(next);
}

/** Pure helper: build a decision payload for the given answers. Centralized
 *  here so the panel and the SSE handler share the exact wire shape. */
export function buildAskUserQuestionsDecision(
  answers: AskUserQuestionAnswer[],
): AskUserQuestionsDecision {
  return { answers };
}

/** Pure helper: build the cancel wire shape. */
export function buildAskUserQuestionsCancel(): AskUserQuestionsCancel {
  return { cancelled: true };
}

/** Reset the entire store (e.g. on global state transitions). */
export function resetAskUserQuestionsStore(): void {
  if (state.size === 0) return;
  setState(new Map());
}

/** Imperative submit hook used by the panel — wraps the fetch. Returns true
 *  on a 2xx response, throws otherwise.
 *
 *  The client store is NOT cleared here on success: the panel wants to show a
 *  brief "Answers sent" confirmation before the sticky panel closes, so it
 *  schedules the clear itself (via clearPendingAskUserQuestions). We DO clear
 *  on a non-2xx HTTP response — a failed POST to a dead session means the
 *  wrapper is gone and the entry is stale; keeping the panel up would be
 *  worse. A network-level throw leaves the entry in place so the user can
 *  retry. */
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
        // Stale: the wrapper is gone (e.g. server restart). The panel is
        // pointless now — drop it so the sidebar dot doesn't linger.
        clearPendingAskUserQuestions(sessionId);
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
      }
      return true;
    },
    [],
  );
}