// ============================================================================
// Scroll follow (pure)
//
// The chat window's "keep the newest content in view, unless the user asked to
// read history" behaviour has a handful of rules that are worth pinning down
// without a browser:
//
//   - when following pauses (an upward wheel, a touch drag) and when it resumes
//     (the bottom edge is reached again, an explicit jump, the back-to-bottom
//     button), and what the back-to-bottom affordance shows in each case;
//   - how a scroll position maps to "at the bottom", and how one more growth of
//     the live viewport is judged against the distance the chat had *before*
//     that growth;
//   - which scroll the chat performs for each of those events — container
//     `scrollTo` for the bottom commands (never the end marker's
//     `scrollIntoView`, which aligns to the scrollport edges and leaves the
//     container's bottom padding visible as a gap), the last user message for a
//     send, the end marker for a session-entry navigation;
//   - the first-entry / after-send scrolls the chat performs when messages
//     appear.
//
// The DOM side — reads, `scrollTo`, `requestAnimationFrame`, `ResizeObserver`
// — stays in `components/chat/chat-window/hooks/useScrollFollow.ts`. Like
// `chat-timeline`, `replay` and `panelTabs` (ADR-0002/0003) this module may not
// import React, the DOM, a client hook, or anything from `lib/server`.
// ============================================================================

/** Distance from the bottom edge within which the chat counts as "at the
 *  bottom". Forgiving on purpose: content keeps growing while a tool streams,
 *  so requiring an exact pixel-perfect bottom would make recovery impractical. */
export const SCROLL_BOTTOM_THRESHOLD_PX = 100;

/** Follow state owned by the chat window's scroll hook. */
export interface ScrollFollowState {
  /** Streaming must not pull the view down — the user scrolled away from the
   *  bottom to read history. */
  paused: boolean;
  /** The "back to bottom" affordance is on screen. */
  showToBottom: boolean;
}

/** Nothing has been scrolled yet: following, affordance hidden. */
export const INITIAL_SCROLL_FOLLOW_STATE: ScrollFollowState = { paused: false, showToBottom: false };

/** The scrollport's layout, read straight off the element. */
export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** Distance from the bottom edge, in pixels. */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

/**
 * Where an element sits in its scrollport's coordinate space — the offset that
 * puts it flush with the scrollport's top edge. Shared with the callers that
 * land a row under the header (the last user message after a send).
 */
export function elementScrollTop(input: {
  /** `getBoundingClientRect().top` of the scrollport. */
  containerTop: number;
  /** `getBoundingClientRect().top` of the element. */
  elementTop: number;
  /** `scrollTop` of the scrollport. */
  containerScrollTop: number;
}): number {
  return input.elementTop - input.containerTop + input.containerScrollTop;
}

/**
 * The scroll a decision asks the DOM for. `"none"` is a first-class command:
 * most events only change the follow state, and the caller must stay free of
 * branches.
 */
export type ScrollCommand =
  | "none"
  | "toBottomSmooth"
  | "toBottomInstant"
  | "userMessageToTop"
  | "toMessagesEnd";

/**
 * The outcome of one scroll event: the follow state to record, and the scroll
 * (if any) to perform. A field left out of `follow` keeps its current value —
 * an event that carries no follow change says nothing about it (and the caller
 * must stay free of branches either way).
 */
export interface ScrollFollowDecision {
  follow: Partial<ScrollFollowState>;
  command: ScrollCommand;
}

/** An event that changes neither the follow state nor the scroll position. */
export const NO_FOLLOW_CHANGE: ScrollFollowDecision = { follow: {}, command: "none" };

/** The user scrolled away from the bottom: follow pauses, the button shows. */
const PAUSED_SCROLL_FOLLOW: ScrollFollowDecision = {
  follow: { paused: true, showToBottom: true },
  command: "none",
};

/**
 * Wheel intent in the chat scrollport. Only an upward scroll (`deltaY < 0`)
 * means "I want to read history" and pauses following. Scrolling down while
 * already at the bottom is a no-op — it must not surface the button, and it
 * must not flip a paused view back into following either (only reaching the
 * bottom does that).
 */
export function decideScrollFollowOnWheel(deltaY: number): ScrollFollowDecision {
  return deltaY < 0 ? PAUSED_SCROLL_FOLLOW : NO_FOLLOW_CHANGE;
}

/** A touch drag carries no direction to read, so it always pauses following. */
export function decideScrollFollowOnTouchScroll(): ScrollFollowDecision {
  return PAUSED_SCROLL_FOLLOW;
}

/**
 * A scroll position change in the chat scrollport: following tracks the bottom
 * edge, and so does the affordance — being pulled back to the bottom (by a
 * smooth scroll that finished, or by the user dragging the scrollbar down)
 * resumes following. `metrics` is null while the scrollport is not mounted;
 * then there is nothing to measure and nothing to change.
 */
export function decideScrollFollowOnScroll(metrics: ScrollMetrics | null): ScrollFollowDecision {
  if (!metrics) return NO_FOLLOW_CHANGE;
  const nearBottom = distanceFromBottom(metrics) < SCROLL_BOTTOM_THRESHOLD_PX;
  return { follow: { paused: !nearBottom, showToBottom: !nearBottom }, command: "none" };
}

/** One growth of the nested live viewport, as its `ResizeObserver` reports it. */
export interface ScrollGrowth {
  /** How much taller the viewport became. */
  heightDelta: number;
  /** The chat scrollport's layout *after* that growth. */
  metrics: ScrollMetrics | null;
  /** This chat window is the visible tab. */
  isActive: boolean;
}

/**
 * Follow the live viewport's own growth. The rule is "was I at the bottom
 * before this growth": the observer runs after the layout change, so the
 * pre-growth distance is recovered by subtracting the delta. A view that was
 * already paused when the growth started is deliberately left alone — that is
 * the whole point of pausing — and a view that was scrolled further up is not
 * pulled down either.
 *
 * `isActive` is the one background-tab path worth naming: the per-tab live
 * viewport keeps streaming while its tab is hidden, but a hidden box has no
 * layout at all — it measures 0, so its observer can never report a positive
 * growth to begin with — and judging it against those meaningless numbers
 * would be wrong. A hidden tab is therefore skipped outright. Every other path
 * into this module needs user input or a laid-out box, so it cannot happen
 * while hidden.
 */
export function decideScrollFollowOnGrowth(
  paused: boolean,
  growth: ScrollGrowth,
): ScrollFollowDecision {
  if (!growth.isActive || !growth.metrics || paused || growth.heightDelta <= 0) {
    return NO_FOLLOW_CHANGE;
  }
  const distanceBeforeGrowth = distanceFromBottom(growth.metrics) - growth.heightDelta;
  if (distanceBeforeGrowth > SCROLL_BOTTOM_THRESHOLD_PX) return NO_FOLLOW_CHANGE;
  return { follow: { paused: false, showToBottom: false }, command: "toBottomInstant" };
}

/**
 * The user asked to go back to the bottom (the button, and the two paths that
 * reuse it: manual compaction, and the Ask-User-Questions panel appearing).
 * Follow resumes and the affordance is cleared immediately, before the smooth
 * scroll lands.
 */
export function decideScrollFollowOnBottom(): ScrollFollowDecision {
  return { follow: { paused: false, showToBottom: false }, command: "toBottomSmooth" };
}

/**
 * Following resumes without a scroll of its own: the nested live viewport
 * reached the bottom, or the user made an explicit jump (a search hit, a
 * tool-call row) whose caller scrolls to its own target.
 */
export function resolveScrollFollow(): ScrollFollowDecision {
  return { follow: { paused: false, showToBottom: false }, command: "none" };
}

/** What the chat's entry scroll keys off: how many messages are on screen and
 *  the two one-shot triggers that decide what a change means. */
export interface EntryScrollSignals {
  /** Messages currently rendered. */
  messageCount: number;
  /** A send just happened: land the last user message at the top. */
  pendingScrollToUser: boolean;
  /** This chat window already did its first-entry stick-to-bottom. */
  initialScrollDone: boolean;
}

/** The scroll to perform plus the one-shot triggers after they are consumed. */
export interface EntryScrollDecision {
  command: ScrollCommand;
  pendingScrollToUser: boolean;
  initialScrollDone: boolean;
}

/**
 * What a change in the message count should do.
 *
 * The first entry sticks to the bottom (instantly — there is nothing to
 * animate), a send lands the last user message near the top so the answer has
 * room below it (smoothly), and every later growth moves nothing: streaming is
 * followed by the nested live viewport, not by the page-level scrollport.
 *
 * Both one-shot triggers are consumed here and only here, for every mounted
 * chat window — a hidden tab's scroll writes are no-ops, but its triggers must
 * still be spent so that activating it later behaves exactly like an active one.
 */
export function decideEntryScroll(signals: EntryScrollSignals): EntryScrollDecision {
  if (signals.messageCount === 0) {
    return {
      command: "none",
      pendingScrollToUser: signals.pendingScrollToUser,
      initialScrollDone: signals.initialScrollDone,
    };
  }
  if (signals.pendingScrollToUser) {
    return { command: "userMessageToTop", pendingScrollToUser: false, initialScrollDone: true };
  }
  if (!signals.initialScrollDone) {
    return { command: "toBottomInstant", pendingScrollToUser: false, initialScrollDone: true };
  }
  return {
    command: "none",
    pendingScrollToUser: signals.pendingScrollToUser,
    initialScrollDone: signals.initialScrollDone,
  };
}
