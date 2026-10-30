export const CELEBRATE_TOOL_NAME = "celebrate";

export type CelebrationStyle = "auto" | "confetti" | "cannon" | "grand";

export const CELEBRATE_DEFAULT_DURATION_MS = 5000;
export const CELEBRATE_MAX_DURATION_MS = 15000;

export interface CelebrateDetails {
  style: CelebrationStyle;
  resolvedStyle: "confetti" | "cannon" | "grand";
  durationMs: number;
}
