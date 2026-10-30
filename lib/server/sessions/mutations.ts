import {
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  deleteSessionName,
  writeSessionName,
} from "@/lib/server/session-names";
import { deleteSessionNotify } from "@/lib/server/session-notify";
import { deleteSessionToolSelection } from "@/lib/server/session-tools-config";
import { deleteSessionPermissionMode } from "@/lib/server/session-permission-mode";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
  resolveSessionPath,
} from "./reader";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("sessions/mutations");

export interface RenameSessionResult {
  filePath: string;
}

export interface DeleteSessionResult {
  filePath: string;
  reparentedChildren: number;
}

type DestroyRunningSession = (sessionId: string) => void | Promise<void>;

async function destroyRpcSession(sessionId: string): Promise<void> {
  const { getRpcSession } = await import("@/lib/server/rpc-manager");
  getRpcSession(sessionId)?.destroy();
}

function atomicReplace(filePath: string, content: string, tmpPath: string): void {
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
    }
    throw error;
  }
}

export async function renameSession(
  sessionId: string,
  name: string,
): Promise<RenameSessionResult | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const cleanName = name.replace(/[\r\n]+/g, " ").trim();
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  let lastInfoIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]) as { type?: string };
      if (entry.type === "session_info") {
        lastInfoIdx = i;
        break;
      }
    } catch {
    }
  }

  if (lastInfoIdx >= 0) {
    const entry = JSON.parse(lines[lastInfoIdx]) as Record<string, unknown>;
    entry.name = cleanName;
    lines[lastInfoIdx] = JSON.stringify(entry);
    atomicReplace(filePath, lines.join("\n"), `${filePath}.rename.tmp`);
  } else {
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(cleanName);
  }

  invalidateSessionListCache();
  try {
    writeSessionName(sessionId, cleanName);
  } catch (err) {
    log.warn("failed to mirror session name to sidecar", {
      sessionId,
      error: String(err),
    });
  }
  return { filePath };
}

export async function deleteSession(
  sessionId: string,
  destroyRunningSession: DestroyRunningSession = destroyRpcSession,
): Promise<DeleteSessionResult | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
  let parentSessionPath: string | undefined;
  try {
    const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
    if (header.type === "session") parentSessionPath = header.parentSession;
  } catch {
  }

  const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  let reparentedChildren = 0;
  try {
    const files = readdirSync(dir).filter((file) => file.endsWith(".jsonl") && join(dir, file) !== filePath);
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        if (header.type === "session" && header.parentSession === filePath) {
          header.parentSession = parentSessionPath;
          lines[0] = JSON.stringify(header);
          atomicReplace(childPath, lines.join("\n"), `${childPath}.reparent.tmp`);
          reparentedChildren += 1;
        }
      } catch {
      }
    }
  } catch {
  }

  await destroyRunningSession(sessionId);
  const { stopAllSubagentTasksForParent, SUBAGENT_PARENT_DELETED } = await import(
    "@/lib/server/subagent-tasks"
  );
  stopAllSubagentTasksForParent(sessionId, SUBAGENT_PARENT_DELETED);
  unlinkSync(filePath);
  invalidateSessionPathCache(sessionId);
  invalidateSessionListCache();
  deleteSessionName(sessionId);
  deleteSessionToolSelection(sessionId);
  deleteSessionNotify(sessionId);
  deleteSessionPermissionMode(sessionId);

  return { filePath, reparentedChildren };
}
