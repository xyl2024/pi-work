"use client";

import { useSyncExternalStore } from "react";
import { getStreamingServerSnapshot, getStreamingSnapshot, isStreamingBodyMessage, subscribeStreaming } from "./streamingMessageStore";
import type { StreamingSnapshot } from "./streamingMessageStore";

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
