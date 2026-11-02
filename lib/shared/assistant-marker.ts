export const ASSISTANT_SESSION_ENTRY_TYPE = "pi_work_assistant_session";

export interface AssistantSessionMarkerData {
  version: 1;
  predecessorSessionId?: string;
}

export function isAssistantSessionMarkerData(value: unknown): value is AssistantSessionMarkerData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (data.version !== 1) return false;
  if (data.predecessorSessionId === undefined) return true;
  return typeof data.predecessorSessionId === "string" && data.predecessorSessionId !== "";
}

export function buildAssistantSessionMarkerData(
  predecessorSessionId?: string,
): AssistantSessionMarkerData {
  return predecessorSessionId
    ? { version: 1, predecessorSessionId }
    : { version: 1 };
}
