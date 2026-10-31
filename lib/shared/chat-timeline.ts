import type {
  AgentMessage,
  AssistantMessage,
  ChangeMarker,
  CompactionPoint,
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

export type ChatTimelineDivider =
  | { kind: "compaction"; point: CompactionPoint }
  | { kind: "change"; marker: ChangeMarker };

export interface TimelineDividerInput {
  timeline: ChatTimeline;
  entryIds: readonly string[];
  compactionPoints?: readonly CompactionPoint[];
  changeMarkers?: readonly ChangeMarker[];
}

export interface TimelineDividers {
  beforeVisible: ReadonlyMap<number, readonly ChatTimelineDivider[]>;
  beforeEntryId: ReadonlyMap<string, readonly ChatTimelineDivider[]>;
  trailingCompactionPoints: readonly CompactionPoint[];
  trailingChangeMarkers: readonly ChangeMarker[];
}

type DividerPlacement = "unanchored" | "unrendered" | "placed";

type ChangeAnchor =
  | { kind: "trailing" }
  | { kind: "visible"; index: number };

function changeAnchorKey(markerKind: ChangeMarker["kind"], anchor: ChangeAnchor): string {
  return anchor.kind === "trailing" ? `${markerKind}:trailing` : `${markerKind}:visible:${anchor.index}`;
}

const DIVIDER_ORDER: Record<ChatTimelineDivider["kind"], number> = {
  compaction: 0,
  change: 1,
};

export function buildTimelineDividers(input: TimelineDividerInput): TimelineDividers {
  const renderedEntryIds = new Set(input.entryIds);
  const beforeVisible = new Map<number, ChatTimelineDivider[]>();
  const beforeEntryId = new Map<string, ChatTimelineDivider[]>();
  const trailingCompactionPoints: CompactionPoint[] = [];
  const trailingChangeMarkers: ChangeMarker[] = [];

  const entryIdAtVisibleIndex = (visibleIndex: number): string | null => {
    const sessionIndex = input.timeline.sessionIndexOfVisible(visibleIndex);
    if (sessionIndex === null) return null;
    return input.entryIds[sessionIndex] ?? null;
  };

  const place = (entryId: string | undefined, divider: ChatTimelineDivider): DividerPlacement => {
    if (!entryId) return "unanchored";
    if (!renderedEntryIds.has(entryId)) return "unrendered";
    const visibleIndex = input.timeline.visibleIndexOfEntry(entryId);
    if (visibleIndex === null) return "unrendered";
    const targetEntryId = entryIdAtVisibleIndex(visibleIndex);
    if (!targetEntryId) return "unanchored";
    let dividers = beforeVisible.get(visibleIndex);
    if (!dividers) {
      dividers = [];
      beforeVisible.set(visibleIndex, dividers);
    }
    dividers.push(divider);
    beforeEntryId.set(targetEntryId, dividers);
    return "placed";
  };

  for (const point of input.compactionPoints ?? []) {
    if (place(point.beforeMessageEntryId, { kind: "compaction", point }) === "unanchored") {
      trailingCompactionPoints.push(point);
    }
  }

  const firstVisibleUserIndex = input.timeline.visibleMessages.findIndex(
    (message) => message.role === "user",
  );
  const retainedMarkers: ChangeMarker[] = [];
  if (firstVisibleUserIndex !== -1) {
    const seenAnchors = new Set<string>();
    const changeMarkers = input.changeMarkers ?? [];
    for (let index = changeMarkers.length - 1; index >= 0; index--) {
      const marker = changeMarkers[index];
      let anchor: ChangeAnchor;
      if (!marker.beforeMessageEntryId) {
        anchor = { kind: "trailing" };
      } else {
        const visibleIndex = input.timeline.visibleIndexOfEntry(marker.beforeMessageEntryId);
        if (visibleIndex === null || visibleIndex <= firstVisibleUserIndex) continue;
        anchor = { kind: "visible", index: visibleIndex };
      }
      const anchorKey = changeAnchorKey(marker.kind, anchor);
      if (seenAnchors.has(anchorKey)) continue;
      seenAnchors.add(anchorKey);
      retainedMarkers.push(marker);
    }
    retainedMarkers.reverse();
  }

  for (const marker of retainedMarkers) {
    if (place(marker.beforeMessageEntryId, { kind: "change", marker }) === "unanchored") {
      trailingChangeMarkers.push(marker);
    }
  }

  for (const dividers of beforeVisible.values()) {
    dividers.sort((a, b) => DIVIDER_ORDER[a.kind] - DIVIDER_ORDER[b.kind]);
  }

  return { beforeVisible, beforeEntryId, trailingCompactionPoints, trailingChangeMarkers };
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
