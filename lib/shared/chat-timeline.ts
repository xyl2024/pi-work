import type {
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolResultMessage,
} from "./types";

export function isVisibleChatMessage(message: AgentMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

export interface ChatTimelineInput {
  messages: AgentMessage[];
  entryIds: string[];
  entryTimestamps: (number | undefined)[];
}

export interface ChatTimeline {
  readonly visibleMessages: readonly AgentMessage[];
  readonly visibleCount: number;
  readonly toolCallVisibleIndices: ReadonlyMap<string, number>;
  visibleIndexOfSession(sessionIndex: number): number;
  sessionIndexOfVisible(visibleIndex: number): number | null;
  visibleIndexOfEntry(entryId: string): number | null;
  sliceForReplay(replayIndex: number | null): ChatTimelineSlice;
}

export interface ChatTimelineSlice {
  messages: AgentMessage[];
  entryIds: string[];
  entryTimestamps: (number | undefined)[];
}

export function buildChatTimeline(input: ChatTimelineInput): ChatTimeline {
  const { messages } = input;
  const visibleMessages: AgentMessage[] = [];
  const sessionIndices: number[] = [];
  const visibleOffsets: number[] = [];
  const toolCallVisibleIndices = new Map<string, number>();

  for (let sessionIndex = 0; sessionIndex < messages.length; sessionIndex++) {
    visibleOffsets.push(visibleMessages.length);
    const message = messages[sessionIndex];
    if (!isVisibleChatMessage(message)) continue;
    if (message.role === "assistant") {
      for (const block of (message as AssistantMessage).content ?? []) {
        if (block.type === "toolCall") {
          toolCallVisibleIndices.set(
            (block as ToolCallContent).toolCallId,
            visibleMessages.length,
          );
        }
      }
    }
    sessionIndices.push(sessionIndex);
    visibleMessages.push(message);
  }
  visibleOffsets.push(visibleMessages.length);

  return {
    visibleMessages,
    visibleCount: visibleMessages.length,
    toolCallVisibleIndices,
    visibleIndexOfSession(sessionIndex) {
      const clamped = Math.max(0, Math.min(sessionIndex, messages.length));
      return visibleOffsets[clamped];
    },
    sessionIndexOfVisible(visibleIndex) {
      if (visibleIndex < 0 || visibleIndex >= sessionIndices.length) return null;
      return sessionIndices[visibleIndex];
    },
    visibleIndexOfEntry(entryId) {
      const sessionIndex = input.entryIds.indexOf(entryId);
      if (sessionIndex === -1) return null;
      const clamped = Math.min(sessionIndex, messages.length);
      return visibleOffsets[clamped];
    },
    sliceForReplay(replayIndex) {
      if (replayIndex === null) {
        return {
          messages: input.messages,
          entryIds: input.entryIds,
          entryTimestamps: input.entryTimestamps,
        };
      }
      return {
        messages: input.messages.slice(0, replayIndex),
        entryIds: input.entryIds.slice(0, replayIndex),
        entryTimestamps: input.entryTimestamps.slice(0, replayIndex),
      };
    },
  };
}

export type SearchJumpDecision =
  | { kind: "skip" }
  | { kind: "jump"; entryId: string; visibleIndex: number };

export function decideSearchJump(
  timeline: ChatTimeline,
  pendingEntryId: string | null,
): SearchJumpDecision {
  if (!pendingEntryId) return { kind: "skip" };
  const visibleIndex = timeline.visibleIndexOfEntry(pendingEntryId);
  if (visibleIndex === null) return { kind: "skip" };
  return { kind: "jump", entryId: pendingEntryId, visibleIndex };
}

export function indexToolResults(messages: readonly AgentMessage[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") map.set(message.toolCallId, message);
  }
  return map;
}
