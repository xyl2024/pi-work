export const SCROLL_BOTTOM_THRESHOLD_PX = 100;

export const SCROLL_TOP_THRESHOLD_PX = 4;

export interface ScrollFollowState {
  paused: boolean;
  showToBottom: boolean;
  atTop: boolean;
}

export const INITIAL_SCROLL_FOLLOW_STATE: ScrollFollowState = {
  paused: false,
  showToBottom: false,
  atTop: true,
};

export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

export function isAtTop(metrics: ScrollMetrics): boolean {
  return metrics.scrollTop <= SCROLL_TOP_THRESHOLD_PX;
}

export function elementScrollTop(input: {
  containerTop: number;
  elementTop: number;
  containerScrollTop: number;
}): number {
  return input.elementTop - input.containerTop + input.containerScrollTop;
}

export type ScrollCommand =
  | "none"
  | "toBottomSmooth"
  | "toBottomInstant"
  | "toTopSmooth"
  | "userMessageToTop"
  | "toMessagesEnd";

export interface ScrollFollowDecision {
  follow: Partial<ScrollFollowState>;
  command: ScrollCommand;
}

export const NO_FOLLOW_CHANGE: ScrollFollowDecision = { follow: {}, command: "none" };

const PAUSED_SCROLL_FOLLOW: ScrollFollowDecision = {
  follow: { paused: true, showToBottom: true },
  command: "none",
};

export function decideScrollFollowOnWheel(deltaY: number): ScrollFollowDecision {
  return deltaY < 0 ? PAUSED_SCROLL_FOLLOW : NO_FOLLOW_CHANGE;
}

export function decideScrollFollowOnTouchScroll(): ScrollFollowDecision {
  return PAUSED_SCROLL_FOLLOW;
}

export function decideScrollFollowOnScroll(metrics: ScrollMetrics | null): ScrollFollowDecision {
  if (!metrics) return NO_FOLLOW_CHANGE;
  const nearBottom = distanceFromBottom(metrics) < SCROLL_BOTTOM_THRESHOLD_PX;
  return {
    follow: { paused: !nearBottom, showToBottom: !nearBottom, atTop: isAtTop(metrics) },
    command: "none",
  };
}

export interface ScrollGrowth {
  heightDelta: number;
  metrics: ScrollMetrics | null;
  isActive: boolean;
}

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

export function decideScrollFollowOnBottom(): ScrollFollowDecision {
  return { follow: { paused: false, showToBottom: false }, command: "toBottomSmooth" };
}

export function decideScrollFollowOnTop(): ScrollFollowDecision {
  return { follow: {}, command: "toTopSmooth" };
}

export function resolveScrollFollow(): ScrollFollowDecision {
  return { follow: { paused: false, showToBottom: false }, command: "none" };
}

export interface EntryScrollSignals {
  messageCount: number;
  pendingScrollToUser: boolean;
  initialScrollDone: boolean;
}

export interface EntryScrollDecision {
  command: ScrollCommand;
  pendingScrollToUser: boolean;
  initialScrollDone: boolean;
}

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
