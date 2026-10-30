import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig } from "@/lib/server/config";
import { ensurePathAllowed } from "@/lib/server/file-access";
import { applyMcpPanelChanges, readMcpPanelData } from "@/lib/server/mcp-entries";
import type { McpPanelChange } from "@/lib/shared/mcp-panel";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
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

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; changes?: McpPanelChange[] };
    const { cwd } = body;
    if (!cwd || !Array.isArray(body.changes)) {
      return NextResponse.json({ error: "cwd and changes are required" }, { status: 400 });
    }

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
