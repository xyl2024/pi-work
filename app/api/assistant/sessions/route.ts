import { NextResponse } from "next/server";
import { dataPath } from "@/lib/server/data-dir";
import { listAllSessionsHeaderOnly, readSessionDetails } from "@/lib/server/session-reader";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/assistant/sessions");

export async function GET(req: Request) {
  const startedAt = Date.now();
  const includeMessages = new URL(req.url).searchParams.get("includeMessages") === "1";
  const cwd = dataPath("workspace", "pi-cwd-default");
  try {
    const sessions = await listAllSessionsHeaderOnly(cwd);
    const assistantSessions = sessions
      .filter((session) => session.assistant === true)
      .sort((a, b) => a.created.localeCompare(b.created));
    const payload = includeMessages
      ? await Promise.all(
          assistantSessions.map(async (session) => {
            const details = await readSessionDetails(session.id);
            return { ...session, messages: details?.context.messages ?? [] };
          }),
        )
      : assistantSessions;
    log.debug("assistant sessions listed", {
      cwd,
      returned: assistantSessions.length,
      includeMessages,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ sessions: payload });
  } catch (error) {
    log.error("assistant sessions failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
