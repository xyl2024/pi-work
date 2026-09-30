import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig } from "@/lib/server/config";
import { ensurePathAllowed } from "@/lib/server/file-access";
import { applyMcpPanelChanges, readMcpPanelData } from "@/lib/server/mcp-entries";
import type { McpPanelChange } from "@/lib/shared/mcp-panel";

export const dynamic = "force-dynamic";

// GET /api/mcp?cwd=<path> — both mcp.json files as the MCP panel shows them.
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    // The workspace file is read from a client-supplied cwd, so it has to
    // resolve inside an allowed root — same rule as every other path read.
    if (!(await ensurePathAllowed(cwd))) {
      return NextResponse.json({ error: "cwd is outside the allowed roots" }, { status: 403 });
    }

    return NextResponse.json(
      readMcpPanelData({
        agentDir: getAgentDir(),
        cwd,
        projectTrusted: readConfig().mcp.project_servers,
      }),
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/mcp — apply the panel's pending changes in one read-modify-write per
// file. The body carries only what changed; nothing is written if any change fails
// validation (see lib/server/mcp-entries.ts).
export async function PUT(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; changes?: McpPanelChange[] };
    const { cwd } = body;
    if (!cwd || !Array.isArray(body.changes)) {
      return NextResponse.json({ error: "cwd and changes are required" }, { status: 400 });
    }

    // The workspace file is written inside a client-supplied cwd, so it has to
    // resolve inside an allowed root — same rule as every other file write.
    if (body.changes.some((change) => change?.scope === "project") && !(await ensurePathAllowed(cwd))) {
      return NextResponse.json({ error: "cwd is outside the allowed roots" }, { status: 403 });
    }

    const errors = applyMcpPanelChanges({ agentDir: getAgentDir(), cwd, changes: body.changes });
    if (errors.length > 0) return NextResponse.json({ error: errors.join("\n"), errors }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
