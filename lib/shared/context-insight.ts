import type { SessionEvent } from "./session-events";

export function isContextInsightRefreshEvent(event: SessionEvent): boolean {
  return event.type === "agent_settled" || event.type === "compaction_end";
}
