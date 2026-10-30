import { existsSync, statSync } from "fs";
import { ensurePathAllowed } from "@/lib/server/file-access";

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function validateWorkspaceId(workspaceId: string): Promise<string> {
  const trimmed = workspaceId.trim();
  if (!trimmed) throw new WorkspaceError("workspace_required");
  if (!existsSync(trimmed)) throw new WorkspaceError("workspace_not_found");
  if (!statSync(trimmed).isDirectory()) throw new WorkspaceError("workspace_not_directory");
  if (!(await ensurePathAllowed(trimmed))) throw new WorkspaceError("workspace_not_allowed");
  return trimmed;
}