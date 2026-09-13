"use client";

/**
 * Scroll follow wiring for one chat window.
 *
 * The rules — when following pauses, when it resumes, what the back-to-bottom
 * affordance shows, when a growth of the live viewport may pull the view down,
 * and which scroll each event performs — live in `lib/shared/scroll-follow.ts`.
 * This hook owns only the parts that need a browser: reading the scrollport's
 * layout, writing the scroll offsets, the one-shot entry / send triggers and
 * the `setTimeout` that lands a session-entry navigation. Dependencies (the
 * refs, the visible-tab flag, the report back to the shell) come in as
 * parameters and the hook reads nothing from the environment itself.
 *
 * No rule branches here: every decision is a pure function's return value, and
 * the applier merges it mechanically. The only conditionals left in this file
 * are the DOM writers' null guards (`SCROLL_COMMANDS`, `readScrollMetrics`) —
 * they check that a node exists, they never decide what should happen.
 *
 * The pause flag is a ref rather than state because `StreamingMessageViewport`
 * writes it directly (a wheel inside the nested live viewport must pause the
 * outer chat too). It is therefore owned by the shell and handed to both.
 */

import { useCallback, useEffect, useState, type RefObject, type WheelEvent } from "react";
import {
  INITIAL_SCROLL_FOLLOW_STATE,
  decideEntryScroll,
  decideScrollFollowOnBottom,
  decideScrollFollowOnGrowth,
  decideScrollFollowOnScroll,
  decideScrollFollowOnTouchScroll,
  decideScrollFollowOnWheel,
  elementScrollTop,
  resolveScrollFollow,
  type ScrollCommand,
  type ScrollFollowDecision,
  type ScrollMetrics,
} from "@/lib/shared/scroll-follow";

/** How far above the last user message the view lands after a send. */
const USER_MESSAGE_TOP_GAP_PX = 16;

/** Silence between a session-entry navigation finishing and its landing scroll,
 *  so the reloaded branch has laid out before the end marker is measured. */
const ENTRY_SCROLL_SETTLE_MS = 100;

export interface UseScrollFollowOptions {
  /** True only for the tab currently projected into the visible chat view. */
  isActive: boolean;
  /** The chat scrollport that holds the message rows. */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** End-of-messages marker: where an entry navigation lands. */
  messagesEndRef: RefObject<HTMLDivElement | null>;
  /** The last user message row: where a send lands the view. */
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  /** Shared pause flag, written by the nested live viewport as well (see the
   *  file header) — so it is owned by the shell, not by this hook. */
  pausedRef: RefObject<boolean>;
  /** Messages on screen; a change is what the entry / send rules key off. */
  messageCount: number;
  /** Set by a send before the user message lands; consumed by the entry rule. */
  pendingScrollToUserRef: RefObject<boolean>;
  /** True once this chat window did its first-entry stick-to-bottom. */
  initialScrollDoneRef: RefObject<boolean>;
  /** Report to the shell once an entry-navigation landing scroll is issued. */
  onScrollComplete?: () => void;
}

export interface UseScrollFollowResult {
  /** The "back to bottom" button is enabled (it stays mounted when disabled). */
  showToBottom: boolean;
  /** `onScroll` of the chat scrollport. */
  handleScroll: () => void;
  /** `onWheel` of the chat scrollport. */
  handleWheel: (event: WheelEvent<HTMLDivElement>) => void;
  /** `onTouchMove` of the chat scrollport. */
  handleTouchMove: () => void;
  /** The nested live viewport reached its bottom. */
  handleResume: () => void;
  /** The nested live viewport's box grew by `heightDelta`. */
  handleHeightIncrease: (heightDelta: number) => void;
  /** The "back to bottom" button — also reused by compaction and the
   *  Ask-User-Questions panel appearing. */
  handleToBottom: () => void;
  /** An explicit jump (a search hit, a tool-call row) re-engages following. */
  handleExplicitScroll: () => void;
  /** A session-entry navigation finished: land at the end of the reloaded
   *  branch (one settle tick later) and report to the shell. Wired into
   *  `useAgentSession` through a stable delegate. */
  handleEntryNavigated: () => void;
}

/** The DOM nodes every scroll command writes to, read at call time. */
interface ScrollTargets {
  container: HTMLDivElement | null;
  lastUserMessage: HTMLDivElement | null;
  messagesEnd: HTMLDivElement | null;
}

/** Read the scrollport's layout; a node that is not mounted yet has none. */
function readScrollMetrics(el: HTMLDivElement | null): ScrollMetrics | null {
  if (!el) return null;
  return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight };
}

/**
 * The DOM side of `ScrollCommand`: writes only, no decisions — what to scroll
 * is decided in the pure module. `scrollHeight` (rather than the end marker's
 * `scrollIntoView`) is deliberate for the bottom commands: `scrollIntoView`
 * aligns to the scrollport edges and leaves the container's bottom padding
 * visible as a gap. The null guards cover a command that lands before the chat
 * has mounted the node it targets.
 */
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

  // Resolve the nodes at call time: a command can land before the chat has
  // mounted the row it targets (first render, or a row that is not rendered
  // on this branch yet).
  const readTargets = useCallback(
    (): ScrollTargets => ({
      container: scrollContainerRef.current,
      lastUserMessage: lastUserMsgRef.current,
      messagesEnd: messagesEndRef.current,
    }),
    [scrollContainerRef, lastUserMsgRef, messagesEndRef],
  );

  // The one place a decision is applied: record the follow state it asks for
  // (fields it omits keep their current value), then perform the scroll. The
  // pause flag is read at call time, since the nested live viewport may have
  // written it since the last render.
  const apply = useCallback(
    (decision: ScrollFollowDecision) => {
      pausedRef.current = decision.follow.paused ?? pausedRef.current;
      setShowToBottom((prev) => decision.follow.showToBottom ?? prev);
      SCROLL_COMMANDS[decision.command](readTargets());
    },
    [pausedRef, readTargets],
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

  const handleExplicitScroll = useCallback(() => {
    apply(resolveScrollFollow());
  }, [apply]);

  // First entry sticks to the bottom; a send lands the last user message at the
  // top. Both one-shot triggers are consumed by the pure rule, so this effect
  // is the only place they are spent.
  useEffect(() => {
    const decision = decideEntryScroll({
      messageCount,
      pendingScrollToUser: pendingScrollToUserRef.current,
      initialScrollDone: initialScrollDoneRef.current,
    });
    pendingScrollToUserRef.current = decision.pendingScrollToUser;
    initialScrollDoneRef.current = decision.initialScrollDone;
    SCROLL_COMMANDS[decision.command](readTargets());
  }, [messageCount, pendingScrollToUserRef, initialScrollDoneRef, readTargets]);

  const handleEntryNavigated = useCallback(() => {
    window.setTimeout(() => {
      SCROLL_COMMANDS.toMessagesEnd(readTargets());
    }, ENTRY_SCROLL_SETTLE_MS);
    onScrollComplete?.();
  }, [onScrollComplete, readTargets]);

  return {
    showToBottom,
    handleScroll,
    handleWheel,
    handleTouchMove,
    handleResume,
    handleHeightIncrease,
    handleToBottom,
    handleExplicitScroll,
    handleEntryNavigated,
  };
}
