export interface TurnMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }> | unknown;
  stopReason?: string;
  errorMessage?: string;
}

export interface TurnEvent {
  type: string;
  [key: string]: unknown;
}

export interface TurnSnapshot {
  lastRunMessages: TurnMessage[] | null;
  error: string | null;
}

export const EMPTY_TURN_SNAPSHOT: TurnSnapshot = { lastRunMessages: null, error: null };

export function observeTurnEvent(snapshot: TurnSnapshot, event: TurnEvent): TurnSnapshot {
  if (event.type !== "agent_end") return snapshot;
  const messages = Array.isArray(event.messages) ? (event.messages as TurnMessage[]) : null;
  const error = typeof event.error === "string" && event.error ? event.error : null;
  return { lastRunMessages: messages, error };
}

export type TurnStatus = "completed" | "aborted" | "failed" | "timeout" | "interrupted" | "cancelled";

export type TurnEndReason =
  | { kind: "settled" }
  | { kind: "timeout"; deadlineMs: number }
  | { kind: "interrupted" }
  | { kind: "failed"; error: string }
  | { kind: "cancelled"; reason: string };

export interface TurnOutcome {
  status: TurnStatus;
  text: string;
  hasReply: boolean;
  error: string | null;
  stopReason: string | null;
}

export function eventTurnEndReason(event: TurnEvent): TurnEndReason | null {
  if (event.type === "agent_settled") return { kind: "settled" };
  if (event.type === "prompt_failed") {
    const error = typeof event.error === "string" && event.error ? event.error : "prompt failed";
    return { kind: "failed", error };
  }
  return null;
}

export function classifyTurnEnd(snapshot: TurnSnapshot, reason: TurnEndReason): TurnOutcome {
  if (reason.kind === "timeout") {
    return outcome("timeout", "", false, `max lifetime exceeded: ${reason.deadlineMs}ms`, null);
  }
  if (reason.kind === "interrupted") {
    return outcome("interrupted", "", false, "agent session destroyed before agent_end", null);
  }
  if (reason.kind === "failed") {
    return outcome("failed", "", false, reason.error, null);
  }
  if (reason.kind === "cancelled") {
    return outcome("cancelled", "", false, reason.reason, null);
  }

  const last = lastAssistantMessage(snapshot.lastRunMessages);
  const text = last ? assistantText(last) : "";
  const stopReason = typeof last?.stopReason === "string" ? last.stopReason : null;
  const hasReply = hasReplyText(text);

  if (snapshot.error) {
    return outcome("failed", text, hasReply, snapshot.error, stopReason);
  }
  if (stopReason === "error") {
    return outcome("failed", text, hasReply, last?.errorMessage || "assistant stopReason=error", stopReason);
  }
  if (stopReason === "aborted") {
    return outcome("aborted", text, hasReply, last?.errorMessage || "assistant stopReason=aborted", stopReason);
  }
  return outcome("completed", text, hasReply, null, stopReason);
}

function outcome(
  status: TurnStatus,
  text: string,
  hasReply: boolean,
  error: string | null,
  stopReason: string | null,
): TurnOutcome {
  return { status, text, hasReply, error, stopReason };
}

function lastAssistantMessage(messages: TurnMessage[] | null): TurnMessage | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return null;
}

function assistantText(message: TurnMessage): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type?: string; text?: string } => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function hasReplyText(text: string): boolean {
  return text.trim().length > 0;
}
