export const STREAMING_VIEWPORT_MIN_HEIGHT_PX = 320;

export const STREAMING_VIEWPORT_MAX_WINDOW_RATIO = 0.65;

export const STREAMING_VIEWPORT_ABSOLUTE_MAX_HEIGHT_PX = 720;

export const STREAMING_VIEWPORT_FALLBACK_HEIGHT_PX = 500;

export const STREAMING_VIEWPORT_MARGIN_BOTTOM_PX = 16;

export const STREAMING_STATUS_ROW_HEIGHT_PX = 40;

export const STREAMING_USER_MESSAGE_GAP_PX = 16;

export const STREAMING_TRANSCRIPT_PADDING_TOP_PX = 16;

export const STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX = 80;

export const STREAMING_VIEWPORT_TRAILING_SPACE_PX =
  STREAMING_VIEWPORT_MARGIN_BOTTOM_PX + STREAMING_STATUS_ROW_HEIGHT_PX;

export interface StreamingViewportHeightInput {
  transcriptClientHeight: number;
  userMessageBlockHeight: number;
  windowHeight: number;
}

export function resolveStreamingViewportHeight(input: StreamingViewportHeightInput): number {
  const available = Math.max(
    0,
    input.transcriptClientHeight -
      STREAMING_TRANSCRIPT_PADDING_TOP_PX -
      STREAMING_TRANSCRIPT_PADDING_BOTTOM_PX -
      STREAMING_VIEWPORT_TRAILING_SPACE_PX,
  );
  const budget = available - Math.max(0, input.userMessageBlockHeight) - STREAMING_USER_MESSAGE_GAP_PX;
  const ceiling = Math.min(
    input.windowHeight * STREAMING_VIEWPORT_MAX_WINDOW_RATIO,
    STREAMING_VIEWPORT_ABSOLUTE_MAX_HEIGHT_PX,
  );
  return Math.max(STREAMING_VIEWPORT_MIN_HEIGHT_PX, Math.min(budget, ceiling));
}
