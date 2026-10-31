import { getRpcSession } from "@/lib/server/rpc-manager";
import { openSessionForRuntime } from "@/lib/server/session-runtime-open";
import type { SessionEvent } from "@/lib/shared/session-events";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/agent/[id]/events");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const startedAt = Date.now();
  log.info("agent event stream requested", { id });

  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    try {
      session = (await openSessionForRuntime(id)) ?? undefined;
      if (!session) {
        log.warn("agent event stream session not found", { id, durationMs: elapsedMs(startedAt) });
        return new Response("Session not found", { status: 404 });
      }
      log.info("agent event stream started session", { id, durationMs: elapsedMs(startedAt) });
    } catch (error) {
      log.error("agent event stream failed to start session", { id, error, durationMs: elapsedMs(startedAt) });
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      const connected: SessionEvent = { type: "connected", sessionId: id };
      encode(connected);

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      try {
        session.emitTreeUpdate();
      } catch {
      }

      try {
        for (const event of session.snapshotPendingGates()) encode(event);
      } catch {
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
        log.info("agent event stream closed", { id, durationMs: elapsedMs(startedAt) });
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  log.info("agent event stream connected", { id, durationMs: elapsedMs(startedAt) });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
