import type { StreamAction, StreamingState } from "./types";

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      if (state.isStreaming) return state;
      return { isStreaming: true, streamingMessage: null };
    case "update":
      if (state.isStreaming) return state;
      return { isStreaming: true, streamingMessage: null };
    case "end":
    case "reset":
      if (!state.isStreaming && state.streamingMessage === null) return state;
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}
