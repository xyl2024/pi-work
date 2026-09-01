"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";

/**
 * Keeps the live assistant output inside its own scrollport. Historical
 * messages remain in the page-level chat scroll container; only the current
 * turn grows inside this fixed-height viewport while the agent is running.
 */
const STREAMING_VIEWPORT_HEIGHT = 360;

interface Props {
  tabId: string;
  children: ReactNode;
}

export function StreamingMessageViewport({ tabId, children }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { streamingMessage } = useStreamingMessage(tabId);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Keep the newest content visible without exposing a second vertical
    // scrollbar. `overflow-y: hidden` still permits programmatic scrolling.
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, []);

  // `children` changes when a settled intermediate assistant message or a
  // partial tool result arrives; the streaming snapshot changes per frame.
  // Both cases keep the newest live content visible while the fixed-height
  // area remains free of its own vertical scrolling UI.
  useEffect(() => {
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [children, scrollToBottom, streamingMessage]);

  return (
    <div
      ref={viewportRef}
      data-streaming-message-viewport
      style={{
        boxSizing: "border-box",
        height: STREAMING_VIEWPORT_HEIGHT,
        flexShrink: 0,
        overflowX: "hidden",
        overflowY: "hidden",
        marginBottom: 16,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "transparent",
      }}
    >
      <div className="streaming-message-viewport-content">{children}</div>
    </div>
  );
}
