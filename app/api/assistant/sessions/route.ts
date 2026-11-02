import { NextResponse } from "next/server";
import { dataPath } from "@/lib/server/data-dir";
import { listAllSessionsHeaderOnly } from "@/lib/server/session-reader";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/assistant/sessions");

export async function GET() {
  const startedAt = Date.now();
  const cwd = dataPath("workspace", "pi-cwd-default");
  try {
    const sessions = await listAllSessionsHeaderOnly(cwd);
    const assistantSessions = sessions.filter((session) => session.assistant === true);
    log.debug("assistant sessions listed", {
      cwd,
      returned: assistantSessions.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ sessions: assistantSessions });
  } catch (error) {
    log.error("assistant sessions failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
