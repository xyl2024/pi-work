import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/agent/tools");

// POST /api/agent/tools  body: { cwd: string }
// Lists the tools that pi would register for `cwd`, without instantiating a
// persistent AgentSession. Used by the ChatInput tools popover for brand-new
// sessions that haven't sent their first message yet (so there's no
// sessionId to call `get_tools` on).
//
// Implementation: spin up an ephemeral session via startRpcSession with a
// one-time tempKey, call the existing `get_tools` command, then destroy().
// The wrapper never appears in the sidebar because we don't push a session
// file to disk for it — and we delete the registry entry synchronously
// inside the finally block. Cost is one create + one destroy per popover
// open, which is acceptable (the popover opens a handful of times per
// session at most).
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    const tempKey = `__tools_probe__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { session } = await startRpcSession(tempKey, "", cwd, "all");
    try {
      // get_tools returns [{name, description, active}]; the frontend only
      // needs the catalog (active defaults to "all" for new sessions).
      const tools = (await session.send({ type: "get_tools" })) as Array<{
        name: string;
        description: string;
      }>;
      log.info("ephemeral tools listed", {
        cwd,
        count: tools.length,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ success: true, data: { available: tools } });
    } finally {
      session.destroy();
    }
  } catch (error) {
    log.error("ephemeral tools list failed", {
      error: String(error),
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}