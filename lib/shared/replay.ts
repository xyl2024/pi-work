export interface ReplaySessionSignals {
  isStreaming: boolean;
  agentRunning: boolean;
}

export interface ReplayState {
  open: boolean;
  index: number;
  playing: boolean;
  speed: number;
}

export const INITIAL_REPLAY_STATE: ReplayState = {
  open: false,
  index: 0,
  playing: false,
  speed: 1,
};

export type ReplayEvent =
  | { type: "sessionChanged" }
  | { type: "liveStateChanged"; signals: ReplaySessionSignals }
  | { type: "opened"; total: number }
  | { type: "closed" }
  | { type: "indexChanged"; index: number }
  | { type: "playingChanged"; playing: boolean }
  | { type: "speedChanged"; speed: number };

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

export function isReplayAvailable(signals: ReplaySessionSignals): boolean {
  return !signals.isStreaming && !signals.agentRunning;
}

export function isReplayButtonVisible(
  signals: ReplaySessionSignals,
  messageCount: number,
): boolean {
  return isReplayAvailable(signals) && messageCount > 0;
}

export function replayCropIndex(
  state: ReplayState,
  signals: ReplaySessionSignals,
): number | null {
  return state.open && isReplayAvailable(signals) ? state.index : null;
}

export function replayPositionLabel(
  index: number,
  messages: readonly { timestamp?: number }[],
): string {
  const base = `${index} / ${messages.length}`;
  const timestamp = messages[index - 1]?.timestamp;
  return timestamp ? `${base} · ${new Date(timestamp).toLocaleTimeString()}` : base;
}
