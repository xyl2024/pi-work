import {
  DEFAULT_BACKGROUND_PERMISSION_MODE,
  DEFAULT_PERMISSION_MODE,
  resolveBackgroundPermissionMode,
  type BackgroundPermissionMode,
  type SessionPermissionMode,
  type SessionPermissionState,
} from "../shared/permission-mode";
import { getRpcSession } from "./session-registry";
import { readSessionPermissionMode, readSessionPermissionModes } from "./session-permission-mode";
import {
  getSubagentTaskByChildSessionId,
  hasSubagentStore,
  listSubagentChildConfigSnapshots,
} from "./subagent-store";
import {
  getRunSessionPermissionMode,
  listRunSessionPermissionModes,
} from "./scheduler/store";

function snapshotPermissionMode(configSnapshot: string | null): BackgroundPermissionMode {
  if (!configSnapshot) return DEFAULT_BACKGROUND_PERMISSION_MODE;
  try {
    const parsed = JSON.parse(configSnapshot) as { permissionMode?: unknown };
    return resolveBackgroundPermissionMode(parsed.permissionMode);
  } catch {
    return DEFAULT_BACKGROUND_PERMISSION_MODE;
  }
}

export function resolveSessionPermission(sessionId: string): SessionPermissionState {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) {
    return { permissionMode: live.permissionMode, background: live.isBackgroundSession };
  }

  const subagentTask = hasSubagentStore() ? getSubagentTaskByChildSessionId(sessionId) : null;
  if (subagentTask) {
    return {
      permissionMode: snapshotPermissionMode(subagentTask.configSnapshot),
      background: true,
    };
  }

  const runPermissionMode = getRunSessionPermissionMode(sessionId);
  if (runPermissionMode !== null) {
    return { permissionMode: runPermissionMode, background: true };
  }

  return { permissionMode: readSessionPermissionMode(sessionId), background: false };
}

export function resolveSessionPermissions(
  sessionIds: readonly string[],
): Record<string, SessionPermissionState> {
  const subagentSnapshots = new Map<string, string | null>();
  for (const row of listSubagentChildConfigSnapshots()) {
    if (!subagentSnapshots.has(row.childSessionId)) {
      subagentSnapshots.set(row.childSessionId, row.configSnapshot);
    }
  }
  const runModes = listRunSessionPermissionModes();
  const sidecarModes = readSessionPermissionModes();

  const resolved: Record<string, SessionPermissionState> = {};
  for (const sessionId of sessionIds) {
    const live = getRpcSession(sessionId);
    if (live?.isAlive()) {
      resolved[sessionId] = {
        permissionMode: live.permissionMode,
        background: live.isBackgroundSession,
      };
      continue;
    }
    if (subagentSnapshots.has(sessionId)) {
      resolved[sessionId] = {
        permissionMode: snapshotPermissionMode(subagentSnapshots.get(sessionId) ?? null),
        background: true,
      };
      continue;
    }
    const runMode = runModes[sessionId];
    if (runMode) {
      resolved[sessionId] = { permissionMode: runMode, background: true };
      continue;
    }
    resolved[sessionId] = {
      permissionMode: sidecarModes[sessionId] ?? DEFAULT_PERMISSION_MODE,
      background: false,
    };
  }
  return resolved;
}

export function sessionPermissionFields(
  state: SessionPermissionState | undefined,
): { permissionMode?: SessionPermissionMode; background?: boolean } {
  if (!state) return {};
  return {
    ...(state.permissionMode !== DEFAULT_PERMISSION_MODE
      ? { permissionMode: state.permissionMode }
      : {}),
    ...(state.background ? { background: true } : {}),
  };
}
