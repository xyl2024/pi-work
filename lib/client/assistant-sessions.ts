import type { AgentMessage, SessionInfo } from "../shared/types";

export interface AssistantSessionPayload extends SessionInfo {
  messages?: AgentMessage[];
}

export async function fetchAssistantSessions(
  options: { includeMessages?: boolean } = {},
): Promise<AssistantSessionPayload[]> {
  const query = options.includeMessages ? "?includeMessages=1" : "";
  const response = await fetch(`/api/assistant/sessions${query}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as { sessions?: AssistantSessionPayload[] };
  return data.sessions ?? [];
}
