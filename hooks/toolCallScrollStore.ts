"use client";

import { useCallback } from "react";

/**
 * Module store holding the one `toolCallId → chat scroll` bridge.
 *
 * ChatWindow's `handleScrollToToolCall` depends on `toolCallToVisibleIdx`, which
 * is rebuilt every time `messages` changes, so its identity is unstable. We
 * stash the latest callback in a module ref and expose a stable wrapper hook.
 *
 * The bridge exists because the two ends live in separate subtrees: the
 * context-composition panel (inside the chat header) asks for the jump, while
 * the chat scroll container lives in `ChatWindow`. A module ref is that channel
 * — the same pattern as `sessionUiStore` — and it is the repo's only
 * `toolCallId → chat` channel, so a second one must not grow next to it.
 *
 * The callback is registered per chat tab (`ownerId`): a tab that is not active
 * never registers, and unmounting a tab clears only its own registration.
 */

let scrollCallbackRef: ((toolCallId: string) => void) | null = null;
let scrollCallbackOwner: string | null = null;

export function setToolCallScrollCallback(
  fn: ((toolCallId: string) => void) | null,
  ownerId?: string,
) {
  if (fn === null && ownerId && scrollCallbackOwner !== ownerId) return;
  scrollCallbackRef = fn;
  scrollCallbackOwner = fn === null ? null : ownerId ?? null;
}

export function useToolCallScroll(): (toolCallId: string) => void {
  return useCallback((toolCallId: string) => {
    scrollCallbackRef?.(toolCallId);
  }, []);
}
