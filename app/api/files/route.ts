import { NextRequest } from "next/server";
import { handleFilesGet } from "./handler";

// GET /api/files — the zero-segment form of /api/files/[...path].
// Next's catch-all route requires at least one path segment, so this
// dedicated route serves the root directory ("/") — used by the CwdPicker
// folder dialog when the user navigates to the filesystem root.
export function GET(request: NextRequest) {
  return handleFilesGet(request, []);
}
