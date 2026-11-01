"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX,
  resolveStreamingViewportHeight,
} from "@/lib/shared/streamingViewportHeight";

export interface UseStreamingViewportHeightOptions {
  active: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  userMessageRef: RefObject<HTMLDivElement | null>;
  userScrollingUpRef: RefObject<boolean>;
}

export interface UseStreamingViewportHeightResult {
  maxHeight: number;
  recalculate: () => void;
}

export function useStreamingViewportHeight({
  active,
  transcriptRef,
  userMessageRef,
  userScrollingUpRef,
}: UseStreamingViewportHeightOptions): UseStreamingViewportHeightResult {
  const [maxHeight, setMaxHeight] = useState(STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX);
  const frameRef = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedUserMessageRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (userScrollingUpRef.current) return;
    setMaxHeight(
      resolveStreamingViewportHeight({
        transcriptClientHeight: transcript.clientHeight,
        userMessageBlockHeight: userMessageRef.current?.offsetHeight ?? 0,
        windowHeight: window.innerHeight,
      }),
    );
  }, [transcriptRef, userMessageRef, userScrollingUpRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    if (!active) {
      setMaxHeight(STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX);
      return;
    }
    const transcript = transcriptRef.current;
    if (!transcript || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    observerRef.current = observer;
    observedUserMessageRef.current = null;
    observer.observe(transcript);
    schedule();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedUserMessageRef.current = null;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, schedule, transcriptRef]);

  useEffect(() => {
    if (!active) return;
    const observer = observerRef.current;
    if (!observer) return;
    const userMessage = userMessageRef.current;
    if (userMessage === observedUserMessageRef.current) return;
    if (observedUserMessageRef.current) observer.unobserve(observedUserMessageRef.current);
    observedUserMessageRef.current = userMessage;
    if (userMessage) observer.observe(userMessage);
    schedule();
  });

  return { maxHeight, recalculate: schedule };
}
