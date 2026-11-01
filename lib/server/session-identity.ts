import { getRunSessionPermissionMode } from "./scheduler/store";
import {
  getSubagentTaskByChildSessionId,
  hasSubagentStore,
  type SubagentTask,
} from "./subagent-store";
import type { BackgroundPermissionMode } from "../shared/permission-mode";

export interface BackgroundSessionIdentity {
  subagentTask: SubagentTask | null;
  scheduledPermissionMode: BackgroundPermissionMode | null;
}

export function resolveBackgroundSessionIdentity(sessionId: string): BackgroundSessionIdentity {
  return {
    subagentTask: hasSubagentStore() ? getSubagentTaskByChildSessionId(sessionId) : null,
    scheduledPermissionMode: getRunSessionPermissionMode(sessionId),
  };
}
