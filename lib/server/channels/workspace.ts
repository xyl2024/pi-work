/**
 * Workspace path validation for channel bindings.
 *
 * A channel's workspace is an absolute cwd the agent runs in. It must be a
 * real directory *inside* the pi-work allowed roots (see
 * `lib/server/file-access.ts`) — a raw user string is never trusted.
 */
import { existsSync, statSync } from "fs";
import { ensurePathAllowed } from "@/lib/server/file-access";

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * Validate + normalize a channel workspace path.
 *
 * Throws `WorkspaceError` with a stable machine code:
 *   - "workspace_required"     empty after trim
 *   - "workspace_not_found"    path does not exist
 *   - "workspace_not_directory" path exists but is not a directory
 *   - "workspace_not_allowed"  outside the allowed roots
 */
export async function validateWorkspaceId(workspaceId: string): Promise<string> {
  const trimmed = workspaceId.trim();
  if (!trimmed) throw new WorkspaceError("workspace_required");
  if (!existsSync(trimmed)) throw new WorkspaceError("workspace_not_found");
  if (!statSync(trimmed).isDirectory()) throw new WorkspaceError("workspace_not_directory");
  if (!(await ensurePathAllowed(trimmed))) throw new WorkspaceError("workspace_not_allowed");
  return trimmed;
}