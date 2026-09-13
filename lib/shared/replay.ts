// ============================================================================
// Replay (pure)
//
// The chat window's message-level "time travel" scrubber has four rules that
// are worth pinning down without a browser:
//
//   - when replay is available at all (a settled session: neither streaming
//     nor running) and when the shell's Replay entry may be shown;
//   - what the scrubber's state does over its lifetime — opening at the end of
//     the conversation, a live session forcing it shut, a session switch
//     closing it (a reducer, so the wiring hook has no branch of its own);
//   - which cutoff the chat crops to (`null` = the whole conversation), fed to
//     `chat-timeline`'s `sliceForReplay`, the module that owns cropping;
//   - the "current / total · time" position label.
//
// Like `chat-timeline` and `panelTabs` (ADR-0002/0003) this module may not
// import React, the DOM, a client hook, or anything from `lib/server`.
// ============================================================================

/** Live-session signals that decide whether replay may run. */
export interface ReplaySessionSignals {
  /** The agent is streaming a reply (the SSE tail is live). */
  isStreaming: boolean;
  /** A turn is in progress. */
  agentRunning: boolean;
}

/** Scrubber state owned by the chat window's replay hook. */
export interface ReplayState {
  /** The scrubber is open — a live session may still be hiding it. */
  open: boolean;
  /** Cutoff N — the chat renders messages[0..N]. */
  index: number;
  /** The playback clock is running. */
  playing: boolean;
  /** Playback speed multiplier (`ReplayBar` cycles 0.5 / 1 / 1.5 / 2). */
  speed: number;
}

export const INITIAL_REPLAY_STATE: ReplayState = {
  open: false,
  index: 0,
  playing: false,
  speed: 1,
};

export type ReplayEvent =
  /** The selected session changed — replay does not carry over. */
  | { type: "sessionChanged" }
  /** Streaming / running state changed; a live session force-closes replay. */
  | { type: "liveStateChanged"; signals: ReplaySessionSignals }
  /** The user opened replay — start at the end of the conversation. */
  | { type: "opened"; total: number }
  | { type: "closed" }
  | { type: "indexChanged"; index: number }
  | { type: "playingChanged"; playing: boolean }
  | { type: "speedChanged"; speed: number };

/** Close the scrubber, keeping the cutoff and speed. Keeps state identity when
 *  it is already closed, so the dispatch effects never churn a render. */
function closing(state: ReplayState): ReplayState {
  return state.open || state.playing ? { ...state, open: false, playing: false } : state;
}

export function replayReducer(state: ReplayState, event: ReplayEvent): ReplayState {
  switch (event.type) {
    case "sessionChanged":
      return closing(state);
    case "liveStateChanged":
      return isReplayAvailable(event.signals) ? state : closing(state);
    case "opened":
      return { ...state, open: true, index: event.total, playing: false };
    case "closed":
      return closing(state);
    case "indexChanged":
      return { ...state, index: event.index };
    case "playingChanged":
      return { ...state, playing: event.playing };
    case "speedChanged":
      return { ...state, speed: event.speed };
  }
}

/**
 * Replay is available only for a settled session: a replay cutoff and a live
 * SSE tail must not coexist, so a streaming or running session disables it.
 */
export function isReplayAvailable(signals: ReplaySessionSignals): boolean {
  return !signals.isStreaming && !signals.agentRunning;
}

/** The shell's Replay entry additionally needs something to scrub. */
export function isReplayButtonVisible(
  signals: ReplaySessionSignals,
  messageCount: number,
): boolean {
  return isReplayAvailable(signals) && messageCount > 0;
}

/**
 * The cutoff the chat crops to: the open index on a settled session, or `null`
 * for "render the whole conversation" (replay closed, or forced shut by a live
 * session). Pass the result straight to `ChatTimeline.sliceForReplay`.
 */
export function replayCropIndex(
  state: ReplayState,
  signals: ReplaySessionSignals,
): number | null {
  return state.open && isReplayAvailable(signals) ? state.index : null;
}

/**
 * The scrubber's position label: "12 / 47", plus " · 14:23:01" when the
 * message at the cutoff carries a timestamp.
 */
export function replayPositionLabel(
  index: number,
  messages: readonly { timestamp?: number }[],
): string {
  const base = `${index} / ${messages.length}`;
  const timestamp = messages[index - 1]?.timestamp;
  return timestamp ? `${base} · ${new Date(timestamp).toLocaleTimeString()}` : base;
}
