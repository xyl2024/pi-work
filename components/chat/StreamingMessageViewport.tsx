"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";

/**
 * Keeps the live assistant output inside its own scrollport. Historical
 * messages remain in the page-level chat scroll container; only the current
 * turn grows inside this viewport while the agent is running.
 *
 * The height is dynamic: it grows with the content up to this maximum, then
 * scrolls once the live output exceeds it.
 */
const STREAMING_VIEWPORT_MAX_HEIGHT = 360;
const BOTTOM_THRESHOLD_PX = 1;

interface Props {
  tabId: string;
  children: ReactNode;
  /** Outer page-level chat scroll container. Synced to the bottom as this
   *  viewport grows with content, unless the user has scrolled up. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** True while the user has intentionally scrolled up from the bottom of the
   *  conversation — while set, the outer container is left where it is. */
  userScrollingUpRef?: React.RefObject<boolean>;
}

export function StreamingMessageViewport({ tabId, children, scrollContainerRef, userScrollingUpRef }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const { streamingMessage } = useStreamingMessage(tabId);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    autoScrollEnabledRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !autoScrollEnabledRef.current) return;
    // Keep the newest content visible as it grows. No-op (clamped to 0) while
    // the content still fits within the max-height; only scrolls once the
    // live output exceeds the container. Scrolling up disables this until the
    // user returns to the bottom.
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, []);

  // `children` changes when a settled intermediate assistant message or a
  // partial tool result arrives; the streaming snapshot changes per frame.
  // Both cases keep the newest live content visible once the viewport starts
  // scrolling.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
      // While this viewport grows (content below the max-height cap), the
      // outer conversation scrollport's total height grows with it. ChatWindow
      // only auto-scrolls the outer container on stream start/end, not per
      // frame, so we sync it here so the newest live output stays pinned at
      // the bottom — unless the user has scrolled up to read earlier content.
      const outer = scrollContainerRef?.current;
      if (outer && !userScrollingUpRef?.current) {
        outer.scrollTo({ top: outer.scrollHeight, behavior: "instant" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [children, scrollToBottom, streamingMessage, scrollContainerRef, userScrollingUpRef]);

  return (
    <div
      ref={viewportRef}
      data-streaming-message-viewport
      onScroll={handleScroll}
      style={{
        boxSizing: "border-box",
        maxHeight: STREAMING_VIEWPORT_MAX_HEIGHT,
        flexShrink: 0,
        overflowX: "hidden",
        overflowY: "auto",
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
