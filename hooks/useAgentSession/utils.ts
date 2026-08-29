import type { AgentMessage, AssistantMessage } from "@/lib/shared/types";
import type { StreamAction, StreamingState } from "./types";

/**
 * Tracks the streaming *phase* (`isStreaming` flag) only. The actual
 * streaming message content lives in `hooks/streamingMessageStore.ts`
 * so per-token updates don't re-render ChatWindowContent's full tree
 * (ChatInput, historical messages, panels, ...) on every token — only
 * the StreamingBubble subscriber flips.
 *
 * The reducer keeps `streamingMessage: null` because no consumer reads
 * it through `streamState` anymore; subscribers should go through the
 * standalone store via `useStreamingMessage()`.
 */
export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      if (state.isStreaming) return state;
      return { isStreaming: true, streamingMessage: null };
    case "update":
      // isStreaming flag stays true; payload is delivered via the streaming store.
      if (state.isStreaming) return state;
      return { isStreaming: true, streamingMessage: null };
    case "end":
    case "reset":
      if (!state.isStreaming && state.streamingMessage === null) return state;
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

export function sameCompletedMessage(a: AgentMessage, b: AgentMessage): boolean {
  if (a.role !== b.role) return false;
  if (a.role === "toolResult" && b.role === "toolResult" && a.toolCallId !== b.toolCallId) return false;
  const aTimestamp = "timestamp" in a ? a.timestamp : undefined;
  const bTimestamp = "timestamp" in b ? b.timestamp : undefined;
  if (aTimestamp !== undefined && bTimestamp !== undefined && aTimestamp !== bTimestamp) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function isBodyMessage(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  if ((msg as AssistantMessage).stopReason === "error") return false;
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  let hasText = false;
  let hasToolUse = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "text" && typeof typedBlock.text === "string" && typedBlock.text.trim().length > 0) {
      hasText = true;
    }
    if (typedBlock.type === "toolUse") hasToolUse = true;
  }
  return hasText && !hasToolUse;
}

export function bashCommandTouchesGit(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string" || command.length === 0) return false;
  return /\bgit\b/.test(command);
}
