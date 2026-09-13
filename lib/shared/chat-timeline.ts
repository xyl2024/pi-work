// ============================================================================
// Chat timeline (pure)
//
// The chat window renders a session's conversation projected into rows. Four
// rules used to be hand-derived in four separate places inside `ChatWindow`:
//
//   - which messages are visible (user / assistant only);
//   - session index ↔ visible index (the in-session search jump);
//   - tool call id → visible index (the tool-call stats jump);
//   - which messages / entry ids / timestamps a replay index crops to.
//
// Any drift between them shows up as "the search hit jumped to the wrong
// message" or "clicking a tool call scrolled elsewhere". This module is the
// single source of that projection. Like `panelTabs` (ADR-0002/0003) it may not
// import React, the DOM, a client hook, or anything from `lib/server`.
// ============================================================================

import type {
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolResultMessage,
} from "./types";

/** True for the roles the chat draws as a visible message row. */
export function isVisibleChatMessage(message: AgentMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

/** The conversation arrays a projection is built from. They are parallel by
 *  index; `entryIds` may be shorter than `messages` while an optimistic
 *  message has not been persisted yet. */
export interface ChatTimelineInput {
  messages: AgentMessage[];
  entryIds: string[];
  entryTimestamps: (number | undefined)[];
}

export interface ChatTimeline {
  /** Visible messages in render order (user / assistant only). */
  readonly visibleMessages: readonly AgentMessage[];
  /** Number of visible messages — the length of the render ref array. */
  readonly visibleCount: number;
  /** Tool call id → visible index of the assistant message that issued it. */
  readonly toolCallVisibleIndices: ReadonlyMap<string, number>;
  /**
   * Session index → visible index: how many visible messages precede it. An
   * invisible entry (a matched tool result, a hidden custom message) therefore
   * resolves to the visible message that follows it. Indices at or past the
   * end clamp to `visibleCount`, so the caller can index the ref array safely.
   */
  visibleIndexOfSession(sessionIndex: number): number;
  /** Visible index → session index; null when the visible index is out of range. */
  sessionIndexOfVisible(visibleIndex: number): number | null;
  /** Session entry id → the visible message it resolves to; null when unknown. */
  visibleIndexOfEntry(entryId: string): number | null;
  /**
   * The prefix a replay index renders. `null` keeps the whole conversation
   * (replay closed); `0` renders nothing; a value at or past the total renders
   * everything. The tool-call and tool-result maps are intentionally built from
   * the FULL conversation, so a cropped view still pairs a call with a result
   * that sits past the cutoff.
   */
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
  // visibleOffsets[i] = number of visible messages before session index i.
  // One extra slot at the end covers `sessionIndex === messages.length`.
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

/**
 * Where a pending in-session-search jump should land. Null / unknown entries
 * skip; a known entry resolves through the projection (so an invisible entry
 * lands on the visible message that follows it).
 */
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

/**
 * Tool results by tool call id, built from the FULL conversation so that a
 * replay crop (or a live partial result overlay) still pairs a tool call with
 * the result sitting past the cutoff.
 */
export function indexToolResults(messages: readonly AgentMessage[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") map.set(message.toolCallId, message);
  }
  return map;
}
