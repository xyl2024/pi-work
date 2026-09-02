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
// Use the same forgiving recovery range as the outer chat scrollport. A
// streaming tool can grow while the user is scrolling down, so requiring an
// exact pixel-perfect bottom often makes recovery practically impossible.
const BOTTOM_THRESHOLD_PX = 100;

interface Props {
  tabId: string;
  children: ReactNode;
  /** Shared pause state for both the outer chat scrollport and this nested
   *  viewport. Reaching either scrollport's bottom resumes following. */
  userScrollingUpRef: React.RefObject<boolean>;
  /** Clears the outer "scroll to bottom" affordance when the user reaches the
   *  bottom from inside this nested viewport. */
  onResumeAutoScroll?: () => void;
}

export function StreamingMessageViewport({ tabId, children, userScrollingUpRef, onResumeAutoScroll }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // User intent is handled by wheel/touch/keyboard handlers before the browser
  // emits scroll events. Do not infer it from onScroll: content growth from a
  // streaming tool call can also produce a delayed scroll event.
  const { streamingMessage } = useStreamingMessage(tabId);
  const scrollbarDragRef = useRef(false);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX && userScrollingUpRef.current) {
      // Reaching the bottom is the explicit opt-in to resume following. This
      // must clear the shared pause state too: when the pointer is over this
      // nested viewport, the outer onScroll handler does not receive the event.
      userScrollingUpRef.current = false;
      scrollbarDragRef.current = false;
      onResumeAutoScroll?.();
    } else if (scrollbarDragRef.current) {
      // Scrollbar dragging does not consistently produce wheel events.
      userScrollingUpRef.current = true;
    }
  }, [onResumeAutoScroll, userScrollingUpRef]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scrollbarWidth = viewport.offsetWidth - viewport.clientWidth;
    if (scrollbarWidth > 0 && event.clientX >= viewport.getBoundingClientRect().right - scrollbarWidth) {
      scrollbarDragRef.current = true;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    scrollbarDragRef.current = false;
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      // Any upward user intent pauses following immediately.
      userScrollingUpRef.current = true;
      return;
    }
    if (event.deltaY > 0 && userScrollingUpRef.current) {
      // Resume slightly before the exact bottom. While a tool is emitting
      // arguments, the bottom itself keeps moving, so waiting for an exact
      // zero distance can leave the user permanently just behind it.
      const viewport = viewportRef.current;
      if (!viewport) return;
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
        userScrollingUpRef.current = false;
        onResumeAutoScroll?.();
      }
    }
  }, [onResumeAutoScroll, userScrollingUpRef]);

  const handleTouchMove = useCallback(() => {
    userScrollingUpRef.current = true;
  }, [userScrollingUpRef]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const scrollingKeys = ["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End"];
    if (!scrollingKeys.includes(event.key)) return;
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      userScrollingUpRef.current = true;
      return;
    }
    if (userScrollingUpRef.current) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
        userScrollingUpRef.current = false;
        onResumeAutoScroll?.();
      }
    }
  }, [onResumeAutoScroll, userScrollingUpRef]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || userScrollingUpRef.current) return;
    // Keep the newest content visible as it grows. No-op (clamped to 0) while
    // the content still fits within the max-height; only scrolls once the
    // live output exceeds the container. Scrolling up disables this until the
    // user returns to the bottom.
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, [userScrollingUpRef]);

  const syncScrollToBottom = useCallback(() => {
    // The page-level chat scrollport is intentionally not touched here. Only
    // the live message viewport follows; the outer scroll position remains
    // under the user's control.
    scrollToBottom();
  }, [scrollToBottom]);

  // Tool-call rows can grow in several layout passes: first the tool-call row,
  // then streamed JSON arguments, then an expanded result/collapse animation.
  // Waiting two frames lets all of those DOM measurements settle before we pin
  // the scrollport, instead of pinning to an intermediate scrollHeight.
  const scheduleScrollToBottom = useCallback(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(syncScrollToBottom);
    });
    return firstFrame;
  }, [syncScrollToBottom]);

  // Some tool-call blocks expand after the React render (for example when a
  // delayed result changes a collapse-height animation). In that case the
  // children dependency below fires too early, before the final height exists.
  // Observe the content so every actual height change keeps the viewport
  // pinned when the user is still at the bottom.
  useEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom]);

  // `children` changes when a settled intermediate assistant message or a
  // partial tool result arrives; the streaming snapshot changes per frame.
  // Both cases keep the newest live content visible once the viewport starts
  // scrolling.
  useEffect(() => {
    const frame = scheduleScrollToBottom();
    return () => window.cancelAnimationFrame(frame);
  }, [children, streamingMessage, scheduleScrollToBottom]);

  return (
    <div
      ref={viewportRef}
      data-streaming-message-viewport
      onScroll={handleScroll}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchMove={handleTouchMove}
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
