/**
 * Reverse-sync from a live pi session back to its Kanban card.
 *
 * A card's conversation doesn't have to be a one-shot run: when the user
 * opens the task's session and keeps chatting (sends another prompt), the
 * board should reflect that. This module watches a session the user has
 * continued and, on each finished agent turn, writes the new final output
 * back into the task's result (the card returns to review_test; it was
 * flipped to in_progress by resumeTaskForSession when the prompt was sent).
 *
 * Triggered from POST /api/agent/[id] when a `prompt` command targets a
 * session that belongs to a review_test / done card.
 */

import type { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import type { SessionEvent } from "@/lib/shared/session-events";
import { markRunEnd } from "./store";

interface TextBlock { type: string; text?: string }
interface AssistantMsg {
  role: string;
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

/**
 * The last non-error assistant text from an agent_end messages snapshot
 * (mirrors the extraction in kanban/runner.ts).
 */
export function extractFinalAssistantText(messages: AssistantMsg[]): {
  text: string;
  error?: string;
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (m.stopReason === "error" || m.stopReason === "aborted") {
      return {
        text: "",
        error: m.errorMessage || `assistant stopReason=${m.stopReason}`,
      };
    }
    const text = m.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (text.trim()) return { text };
  }
  return { text: "" };
}

/**
 * Wrappers we've already wired up, keyed by real pi session id. Guards against
 * stacking a fresh onEvent listener every time the user sends a message in a
 * continued session.
 */
const watchedSessions = new Map<string, AgentSessionWrapper>();

/**
 * Subscribe (once per wrapper) to a session the user is continuing so that,
 * on every finished agent turn, the new final output replaces the card's
 * result. If a newer wrapper instance backs the same session (the old one was
 * destroyed and re-created), the stale subscription is replaced.
 */
export function attachSessionSyncWatcher(
  session: AgentSessionWrapper,
  sessionId: string,
  taskId: string,
): void {
  const existing = watchedSessions.get(sessionId);
  if (existing === session) return; // already watching this wrapper

  watchedSessions.set(sessionId, session);
  session.onEvent((event: SessionEvent) => {
    if (event.type !== "agent_end") return;
    const messages = Array.isArray(event.messages) ? (event.messages as AssistantMsg[]) : null;
    if (!messages) return;
    const { text, error } = extractFinalAssistantText(messages);
    if (error) {
      markRunEnd(taskId, { status: "review_test", resultSummary: null, error });
    } else {
      markRunEnd(taskId, {
        status: "review_test",
        resultSummary: text.trim() ? text.slice(0, 2000) : null,
        error: null,
      });
    }
  });
}