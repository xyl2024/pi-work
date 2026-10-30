"use client";

import { useCallback, useEffect, useState, type RefObject, type WheelEvent } from "react";
import {
  INITIAL_SCROLL_FOLLOW_STATE,
  decideEntryScroll,
  decideScrollFollowOnBottom,
  decideScrollFollowOnGrowth,
  decideScrollFollowOnScroll,
  decideScrollFollowOnTop,
  decideScrollFollowOnTouchScroll,
  decideScrollFollowOnWheel,
  elementScrollTop,
  isAtTop,
  resolveScrollFollow,
  type ScrollCommand,
  type ScrollFollowDecision,
  type ScrollMetrics,
} from "@/lib/shared/scroll-follow";

const USER_MESSAGE_TOP_GAP_PX = 16;

const ENTRY_SCROLL_SETTLE_MS = 100;

export interface UseScrollFollowOptions {
  isActive: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  pausedRef: RefObject<boolean>;
  messageCount: number;
  pendingScrollToUserRef: RefObject<boolean>;
  initialScrollDoneRef: RefObject<boolean>;
  onScrollComplete?: () => void;
}

export interface UseScrollFollowResult {
  showToBottom: boolean;
  atTop: boolean;
  handleScroll: () => void;
  handleWheel: (event: WheelEvent<HTMLDivElement>) => void;
  handleTouchMove: () => void;
  handleResume: () => void;
  handleHeightIncrease: (heightDelta: number) => void;
  handleToBottom: () => void;
  handleToTop: () => void;
  handleExplicitScroll: () => void;
  handleEntryNavigated: () => void;
}

interface ScrollTargets {
  container: HTMLDivElement | null;
  lastUserMessage: HTMLDivElement | null;
  messagesEnd: HTMLDivElement | null;
}

function readScrollMetrics(el: HTMLDivElement | null): ScrollMetrics | null {
  if (!el) return null;
  return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight };
}

const SCROLL_COMMANDS: Record<ScrollCommand, (targets: ScrollTargets) => void> = {
  none: () => {},
  toBottomSmooth: ({ container }) => {
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  },
  toBottomInstant: ({ container }) => {
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
  },
  toTopSmooth: ({ container }) => {
    if (!container) return;
    container.scrollTo({ top: 0, behavior: "smooth" });
  },
  userMessageToTop: ({ container, lastUserMessage }) => {
    if (!container || !lastUserMessage) return;
    const top =
      elementScrollTop({
        containerTop: container.getBoundingClientRect().top,
        elementTop: lastUserMessage.getBoundingClientRect().top,
        containerScrollTop: container.scrollTop,
      }) - USER_MESSAGE_TOP_GAP_PX;
    container.scrollTo({ top, behavior: "smooth" });
  },
  toMessagesEnd: ({ messagesEnd }) => {
    messagesEnd?.scrollIntoView({ behavior: "smooth" });
  },
};

export function useScrollFollow({
  isActive,
  scrollContainerRef,
  messagesEndRef,
  lastUserMsgRef,
  pausedRef,
  messageCount,
  pendingScrollToUserRef,
  initialScrollDoneRef,
  onScrollComplete,
}: UseScrollFollowOptions): UseScrollFollowResult {
  const [showToBottom, setShowToBottom] = useState(INITIAL_SCROLL_FOLLOW_STATE.showToBottom);
  const [atTop, setAtTop] = useState(INITIAL_SCROLL_FOLLOW_STATE.atTop);

  const readTargets = useCallback(
    (): ScrollTargets => ({
      container: scrollContainerRef.current,
      lastUserMessage: lastUserMsgRef.current,
      messagesEnd: messagesEndRef.current,
    }),
    [scrollContainerRef, lastUserMsgRef, messagesEndRef],
  );

  const syncAtTop = useCallback(() => {
    const metrics = readScrollMetrics(scrollContainerRef.current);
    if (metrics) setAtTop(isAtTop(metrics));
  }, [scrollContainerRef]);

  const apply = useCallback(
    (decision: ScrollFollowDecision) => {
      pausedRef.current = decision.follow.paused ?? pausedRef.current;
      setShowToBottom((prev) => decision.follow.showToBottom ?? prev);
      setAtTop((prev) => decision.follow.atTop ?? prev);
      SCROLL_COMMANDS[decision.command](readTargets());
      syncAtTop();
    },
    [pausedRef, readTargets, syncAtTop],
  );

  const handleScroll = useCallback(() => {
    apply(decideScrollFollowOnScroll(readScrollMetrics(scrollContainerRef.current)));
  }, [apply, scrollContainerRef]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      apply(decideScrollFollowOnWheel(event.deltaY));
    },
    [apply],
  );

  const handleTouchMove = useCallback(() => {
    apply(decideScrollFollowOnTouchScroll());
  }, [apply]);

  const handleResume = useCallback(() => {
    apply(resolveScrollFollow());
  }, [apply]);

  const handleHeightIncrease = useCallback(
    (heightDelta: number) => {
      apply(
        decideScrollFollowOnGrowth(pausedRef.current, {
          heightDelta,
          metrics: readScrollMetrics(scrollContainerRef.current),
          isActive,
        }),
      );
    },
    [apply, isActive, pausedRef, scrollContainerRef],
  );

  const handleToBottom = useCallback(() => {
    apply(decideScrollFollowOnBottom());
  }, [apply]);

  const handleToTop = useCallback(() => {
    apply(decideScrollFollowOnTop());
  }, [apply]);

  const handleExplicitScroll = useCallback(() => {
    apply(resolveScrollFollow());
  }, [apply]);

  useEffect(() => {
    const decision = decideEntryScroll({
      messageCount,
      pendingScrollToUser: pendingScrollToUserRef.current,
      initialScrollDone: initialScrollDoneRef.current,
    });
    pendingScrollToUserRef.current = decision.pendingScrollToUser;
    initialScrollDoneRef.current = decision.initialScrollDone;
    SCROLL_COMMANDS[decision.command](readTargets());
    syncAtTop();
  }, [messageCount, pendingScrollToUserRef, initialScrollDoneRef, readTargets, syncAtTop]);

  const handleEntryNavigated = useCallback(() => {
    window.setTimeout(() => {
      SCROLL_COMMANDS.toMessagesEnd(readTargets());
    }, ENTRY_SCROLL_SETTLE_MS);
    onScrollComplete?.();
  }, [onScrollComplete, readTargets]);

  return {
    showToBottom,
    atTop,
    handleScroll,
    handleWheel,
    handleTouchMove,
    handleResume,
    handleHeightIncrease,
    handleToBottom,
    handleToTop,
    handleExplicitScroll,
    handleEntryNavigated,
  };
}
