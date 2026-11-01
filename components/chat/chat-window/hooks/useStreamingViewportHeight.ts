"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX,
  resolveStreamingViewportHeight,
  resolveStreamingViewportHeightFromGeometry,
} from "@/lib/shared/streamingViewportHeight";

const STREAMING_VIEWPORT_SELECTOR = "[data-streaming-message-viewport]";

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
  const observedTargetsRef = useRef<Set<HTMLElement>>(new Set());

  const measure = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript || userScrollingUpRef.current) return;
    const viewport = transcript.querySelector<HTMLElement>(STREAMING_VIEWPORT_SELECTOR);
    const userMessage = userMessageRef.current;
    if (viewport && userMessage) {
      const viewportConstrained = viewport.scrollHeight > viewport.clientHeight + 1;
      if (viewportConstrained) {
        const transcriptRect = transcript.getBoundingClientRect();
        const userMessageTopInContent =
          userMessage.getBoundingClientRect().top - transcriptRect.top + transcript.scrollTop;
        setMaxHeight(
          resolveStreamingViewportHeightFromGeometry({
            currentViewportHeight: viewport.offsetHeight,
            transcriptClientHeight: transcript.clientHeight,
            transcriptPaddingTop: Number.parseFloat(window.getComputedStyle(transcript).paddingTop) || 0,
            transcriptScrollHeight: transcript.scrollHeight,
            userMessageTopInContent,
            windowHeight: window.innerHeight,
          }),
        );
        return;
      }
    }
    const budget = resolveStreamingViewportHeight({
      transcriptClientHeight: transcript.clientHeight,
      userMessageBlockHeight: userMessage?.offsetHeight ?? 0,
      windowHeight: window.innerHeight,
    });
    setMaxHeight(viewport ? Math.max(budget, viewport.scrollHeight) : budget);
  }, [transcriptRef, userMessageRef, userScrollingUpRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  const observeTargets = useCallback(() => {
    const observer = observerRef.current;
    if (!observer) return;
    const transcript = transcriptRef.current;
    const targets = [
      userMessageRef.current,
      transcript?.querySelector<HTMLElement>(STREAMING_VIEWPORT_SELECTOR) ?? null,
    ].filter((target): target is HTMLElement => target !== null);
    const observed = observedTargetsRef.current;
    let changed = false;
    for (const target of observed) {
      if (!targets.includes(target)) {
        observer.unobserve(target);
        observed.delete(target);
        changed = true;
      }
    }
    for (const target of targets) {
      if (!observed.has(target)) {
        observer.observe(target);
        observed.add(target);
        changed = true;
      }
    }
    if (changed) schedule();
  }, [schedule, transcriptRef, userMessageRef]);

  useEffect(() => {
    if (!active) {
      setMaxHeight(STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX);
      return;
    }
    const transcript = transcriptRef.current;
    if (!transcript || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    observerRef.current = observer;
    observedTargetsRef.current = new Set();
    observer.observe(transcript);
    observeTargets();
    schedule();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedTargetsRef.current = new Set();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, observeTargets, schedule, transcriptRef]);

  useEffect(() => {
    if (!active) return;
    observeTargets();
  });

  return { maxHeight, recalculate: schedule };
}
