export const TOOLBAR_ICON_STROKE = 1.8;

export const VOICE_INPUT_ACCENT_COLOR = "var(--error)";

export const VOICE_INPUT_WARNING_COLOR = "var(--warning)";

export const voiceInputMetrics = {
  activeBackground: "color-mix(in srgb, var(--error) 12%, transparent)",
  dot: 6,
  timerFont: 9,
  timerLineHeight: 1,
  levelBarHeight: 2,
  errorFont: 12,
  errorMarginBottom: 8,
} as const;

export const chatInputMetrics = {
  font: 12,
  fontSmall: 10,
  lineHeight: 1.6,
  textAreaMinHeight: 20,
  textAreaMaxHeight: 170,
  containerPadding: "0 16px 10px",
  boxPadding: "8px 8px 8px 12px",
  boxBorderRadius: "var(--radius-xl)",
  boxGap: 7,
  toolbarGap: 7,
  menuOffset: 37,
  sendButton: 29,
  sendIcon: 14,
  stopIcon: 10,
  toolbarButton: 27,
  toolbarIcon: 14,
  toolbarLabelPadding: "0 8px",
  toolbarRadius: "var(--radius-sm)",
  labeledPadding: "7px 10px",
  groupGap: 2,
  retryBarPadding: "4px 8px",
  retryIcon: 10,
} as const;
