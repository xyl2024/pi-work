"use client";

import { useSyncExternalStore } from "react";
import { getStreamingServerSnapshot, getStreamingSnapshot, isStreamingBodyMessage, isStreamingToolCallMessage, streamingToolCallBlock, subscribeStreaming } from "./streamingMessageStore";
import type { StreamingSnapshot } from "./streamingMessageStore";
import type { ToolCallContent } from "@/lib/shared/types";

export function useStreamingMessage(key: string): StreamingSnapshot {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => getStreamingSnapshot(key),
    getStreamingServerSnapshot,
  );
}

export function useIsStreamingThinking(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => getStreamingSnapshot(key).isThinking,
    () => false,
  );
}

export function useIsStreaming(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => getStreamingSnapshot(key).isStreaming,
    () => false,
  );
}

export function useStreamingHasContent(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => getStreamingSnapshot(key).hasContent,
    () => false,
  );
}

export function useIsStreamingError(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => {
      const message = getStreamingSnapshot(key).streamingMessage;
      return message?.role === "assistant" && message.stopReason === "error";
    },
    () => false,
  );
}

export function useIsStreamingToolCall(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => {
      const snapshot = getStreamingSnapshot(key);
      return snapshot.isStreaming && isStreamingToolCallMessage(snapshot.streamingMessage);
    },
    () => false,
  );
}

/** The live assistant's last toolCall block (name + args) while a tool call
 *  is being streamed or executed. Narrow selector so per-arg-token updates do
 *  not re-render subscribers — the block object identity only changes when a
 *  new block takes over. */
export function useStreamingToolCall(key: string): ToolCallContent | null {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => {
      const snapshot = getStreamingSnapshot(key);
      return snapshot.isStreaming ? streamingToolCallBlock(snapshot.streamingMessage) : null;
    },
    () => null,
  );
}

/** Stable boolean selector for the live assistant's answer-text phase. */
export function useIsStreamingBody(key: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeStreaming(key, listener),
    () => {
      const snapshot = getStreamingSnapshot(key);
      return snapshot.isStreaming && isStreamingBodyMessage(snapshot.streamingMessage);
    },
    () => false,
  );
}
