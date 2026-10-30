export function parseSessionNotifyChannelId(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const channelId = (config as { channelId?: unknown }).channelId;
  if (typeof channelId !== "string") return null;
  const trimmed = channelId.trim();
  return trimmed ? trimmed : null;
}

export interface SessionNotifySaveInput {
  currentSessionId: string | null | undefined;
  pickedChannelId: string | null;
  savedSessionId: string | null;
}

export type SessionNotifySaveDecision =
  | { kind: "persist"; sessionId: string; channelId: string }
  | { kind: "skip" };

export function decideSessionNotifySave(input: SessionNotifySaveInput): SessionNotifySaveDecision {
  if (!input.currentSessionId) return { kind: "skip" };
  if (input.pickedChannelId == null) return { kind: "skip" };
  if (input.savedSessionId === input.currentSessionId) return { kind: "skip" };
  return { kind: "persist", sessionId: input.currentSessionId, channelId: input.pickedChannelId };
}

export interface SessionNotifyLocallySavedInput {
  sessionId: string;
  savedSessionId: string | null;
}

export function isSessionNotifyBindingLocallySaved(
  input: SessionNotifyLocallySavedInput,
): boolean {
  return input.savedSessionId !== null && input.savedSessionId === input.sessionId;
}
