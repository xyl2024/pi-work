"use client";

import { useSyncExternalStore } from "react";
import { getStreamingServerSnapshot, getStreamingSnapshot, subscribeStreaming } from "./streamingMessageStore";
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
