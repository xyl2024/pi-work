"use client";

import { useCallback } from "react";

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
