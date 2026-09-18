import type { StreamAction, StreamingState } from "./types";

/**
 * Tracks the streaming *phase* (`isStreaming` flag) only. The actual
 * streaming message content lives in `hooks/streamingMessageStore.ts`
 * so per-token updates don't re-render ChatWindowContent's full tree
 * (ChatInput, historical messages, panels, ...) on every token — only
 * the StreamingBubble subscriber flips.
 *
 * The reducer keeps `streamingMessage: null` because no consumer reads
 * it through `streamState` anymore; subscribers should go through the
 * standalone store via `useStreamingMessage()`.
 */
export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      if (state.isStreaming) return state;
      return { isStreaming: true, streamingMessage: null };
    case "update":
      // isStreaming flag stays true; payload is delivered via the streaming store.
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
