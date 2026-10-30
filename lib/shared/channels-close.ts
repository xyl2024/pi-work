import type { LoginPhase } from "./channels-login";

export interface ChannelsCloseConditions {
  phase: LoginPhase | null;
}

export interface ChannelsCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

export const CHANNELS_LOGIN_CLOSE_CONFIRM: ChannelsCloseConfirm = {
  titleKey: "Close while scanning?",
  descriptionKey: "The scan will be interrupted and you'll need a new QR code.",
  confirmLabelKey: "Close",
};

export const CHANNELS_GUARDED_PHASES: readonly LoginPhase[] = [
  "waiting",
  "scanned",
  "verifying",
];

export function selectChannelsCloseConfirm(
  conditions: ChannelsCloseConditions,
): ChannelsCloseConfirm | null {
  if (conditions.phase === null) return null;
  return CHANNELS_GUARDED_PHASES.includes(conditions.phase)
    ? CHANNELS_LOGIN_CLOSE_CONFIRM
    : null;
}
