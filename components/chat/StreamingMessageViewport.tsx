"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";

const STREAMING_VIEWPORT_MAX_HEIGHT = 500;
const BOTTOM_THRESHOLD_PX = 100;

interface Props {
  tabId: string;
  children: ReactNode;
  userScrollingUpRef: React.RefObject<boolean>;
  onResumeAutoScroll?: () => void;
  onHeightIncrease?: (heightDelta: number) => void;
}

export function StreamingMessageViewport({ tabId, children, userScrollingUpRef, onResumeAutoScroll, onHeightIncrease }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousViewportHeightRef = useRef<number | null>(null);
  const { streamingMessage } = useStreamingMessage(tabId);
  const scrollbarDragRef = useRef(false);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX && userScrollingUpRef.current) {
      userScrollingUpRef.current = false;
      scrollbarDragRef.current = false;
      onResumeAutoScroll?.();
    } else if (scrollbarDragRef.current) {
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
      userScrollingUpRef.current = true;
      return;
    }
    if (event.deltaY > 0 && userScrollingUpRef.current) {
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
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, [userScrollingUpRef]);

  const syncScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const scheduleScrollToBottom = useCallback(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(syncScrollToBottom);
    });
    return firstFrame;
  }, [syncScrollToBottom]);

  const handleResize = useCallback((entries: ResizeObserverEntry[]) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (entries.some((entry) => entry.target === viewport)) {
      const height = viewport.offsetHeight;
      const previousHeight = previousViewportHeightRef.current ?? 0;
      const heightDelta = height - previousHeight;
      previousViewportHeightRef.current = height;
      if (heightDelta > 0) onHeightIncrease?.(heightDelta);
    }

    scheduleScrollToBottom();
  }, [onHeightIncrease, scheduleScrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [handleResize]);

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
