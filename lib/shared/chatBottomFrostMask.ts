export const CHAT_BOTTOM_FROST_MASK_HEIGHT_PX = 110;

export const CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY = 0.9;

export const CHAT_BOTTOM_FROST_MASK_BLUR_RADIUS_PX = 8;

export interface FrostMaskGradientStop {
  offsetPx: number;
  opacity: number;
}

export const CHAT_BOTTOM_FROST_MASK_GRADIENT_STOPS: readonly FrostMaskGradientStop[] = Object.freeze([
  { offsetPx: 0, opacity: 0 },
  { offsetPx: CHAT_BOTTOM_FROST_MASK_HEIGHT_PX, opacity: CHAT_BOTTOM_FROST_MASK_PEAK_OPACITY },
] as const);

export function isChatBottomFrostMaskVisible(params: {
  pendingAskUserQuestions: boolean;
}): boolean {
  return !params.pendingAskUserQuestions;
}
