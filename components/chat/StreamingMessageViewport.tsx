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
const STREAMING_VIEWPORT_MAX_HEIGHT = 500;
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
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  // Scroll events caused by our own scrollTo can arrive after content grows.
  // Track user input separately so those delayed events cannot accidentally
  // disable auto-scroll while tool-call arguments are streaming.
  const userScrollInteractionRef = useRef(false);
  const { streamingMessage } = useStreamingMessage(tabId);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
      autoScrollEnabledRef.current = true;
    } else if (userScrollInteractionRef.current) {
      autoScrollEnabledRef.current = false;
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    userScrollInteractionRef.current = true;
    if (event.deltaY < 0) autoScrollEnabledRef.current = false;
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const scrollingKeys = ["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End"];
    if (!scrollingKeys.includes(event.key)) return;
    userScrollInteractionRef.current = true;
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      autoScrollEnabledRef.current = false;
    }
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

  const syncScrollToBottom = useCallback(() => {
    scrollToBottom();
    const outer = scrollContainerRef?.current;
    if (outer && !userScrollingUpRef?.current) {
      outer.scrollTo({ top: outer.scrollHeight, behavior: "instant" });
    }
  }, [scrollToBottom, scrollContainerRef, userScrollingUpRef]);

  // Some tool-call blocks expand after the React render (for example when a
  // delayed result changes a collapse-height animation). In that case the
  // children dependency below fires too early, before the final height exists.
  // Observe the content so every actual height change keeps the viewport
  // pinned when the user is still at the bottom.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(syncScrollToBottom);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [syncScrollToBottom]);

  // `children` changes when a settled intermediate assistant message or a
  // partial tool result arrives; the streaming snapshot changes per frame.
  // Both cases keep the newest live content visible once the viewport starts
  // scrolling.
  useEffect(() => {
    const frame = window.requestAnimationFrame(syncScrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [children, streamingMessage, syncScrollToBottom]);

  return (
    <div
      ref={viewportRef}
      data-streaming-message-viewport
      onScroll={handleScroll}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onTouchStart={() => {
        userScrollInteractionRef.current = true;
      }}
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
      <div ref={contentRef} className="streaming-message-viewport-content">{children}</div>
    </div>
  );
}
