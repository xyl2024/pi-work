import type { CSSProperties } from "react";

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

export interface ChatBottomFrostMaskStyle extends CSSProperties {
  "--chat-frost-mask-blur-radius": string;
  "--chat-frost-mask-gradient": string;
}

export function getChatBottomFrostMaskGradientValue(): string {
  const stops = CHAT_BOTTOM_FROST_MASK_GRADIENT_STOPS.map(
    (stop) => `rgba(0, 0, 0, ${stop.opacity}) ${stop.offsetPx}px`,
  ).join(", ");
  return `linear-gradient(to bottom, ${stops})`;
}

export function getChatBottomFrostMaskStyle(): ChatBottomFrostMaskStyle {
  return {
    height: `${CHAT_BOTTOM_FROST_MASK_HEIGHT_PX}px`,
    "--chat-frost-mask-blur-radius": `${CHAT_BOTTOM_FROST_MASK_BLUR_RADIUS_PX}px`,
    "--chat-frost-mask-gradient": getChatBottomFrostMaskGradientValue(),
};
}

export function isChatBottomFrostMaskVisible(params: {
  pendingAskUserQuestions: boolean;
}): boolean {
  return !params.pendingAskUserQuestions;
}
