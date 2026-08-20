import {
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { deleteAgentTodoFile } from "@/lib/server/agent-todo-tool/store";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
  resolveSessionPath,
} from "./reader";

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
      // Ignore cleanup failures; preserve the original mutation error.
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

  // Update the name in place instead of appending a new session_info entry.
  // appendSessionInfo() writes the entry with parentId = current leaf and
  // advances the leaf to it, so renaming used to add a stray node to the
  // branch tree (and, on reload, made later messages hang off it). Rewriting
  // the existing entry keeps the tree structure untouched.
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
      // Skip malformed lines.
    }
  }

  if (lastInfoIdx >= 0) {
    const entry = JSON.parse(lines[lastInfoIdx]) as Record<string, unknown>;
    entry.name = cleanName;
    lines[lastInfoIdx] = JSON.stringify(entry);
    // Atomic replace: write a temp file in the same dir, then rename over.
    // Avoids readers (sidebar, GET) observing a truncated file mid-write.
    atomicReplace(filePath, lines.join("\n"), `${filePath}.rename.tmp`);
  } else {
    // First naming: the session has no session_info entry yet, and the name
    // must live in one for getSessionName()/listAllSessions() to see it.
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(cleanName);
  }

  invalidateSessionListCache();
  return { filePath };
}

export async function deleteSession(
  sessionId: string,
  destroyRunningSession: DestroyRunningSession = destroyRpcSession,
): Promise<DeleteSessionResult | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  // Read header before deleting to get parentSession path.
  const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
  let parentSessionPath: string | undefined;
  try {
    const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
    if (header.type === "session") parentSessionPath = header.parentSession;
  } catch {
    // Ignore malformed headers, matching the previous route behavior.
  }

  // Re-attach all direct children to this session's parent (cascade re-parent).
  // Scan sibling files in the same directory.
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
          // Keep child JSONL rewrites atomic so readers never observe a
          // truncated session while cascade re-parenting is in progress.
          atomicReplace(childPath, lines.join("\n"), `${childPath}.reparent.tmp`);
          reparentedChildren += 1;
        }
      } catch {
        // Skip malformed or unreadable child sessions.
      }
    }
  } catch {
    // Skip cascade re-parenting if the directory is unreadable.
  }

  await destroyRunningSession(sessionId);
  unlinkSync(filePath);
  invalidateSessionPathCache(sessionId);
  invalidateSessionListCache();
  deleteAgentTodoFile(sessionId);

  return { filePath, reparentedChildren };
}
