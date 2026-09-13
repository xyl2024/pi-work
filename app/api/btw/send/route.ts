// ── POST /api/btw/send ─────────────────────────────────────────────────
//
// SSE endpoint for the BTW (By the way) right-side panel. Each request runs
// a single PURE-CHAT model call (`lib/server/btw-chat.ts`) grounded in the
// active main session's live state — no agent is booted, no tools are
// executed. The route snapshots `{ systemPrompt, thinkingLevel, tools,
// messages }` straight off the main-session wrapper (`btw_context` RPC) so
// the provider receives the same prompt/context/tool prefix the main agent
// would send next, maximising prompt-cache hits.
//
// The wire format mirrors `/api/agent/[id]/events`
// and `/api/translate/route.ts`: each event is `data: <json>\n\n`, plus a
// 30s heartbeat (`:\n\n`) to keep proxies from killing the stream.
//
// The events emitted are the same `type` strings the client already
// understands (`message_update` / `message_end` / `agent_end` / `error`),
// mapped from the SDK's pure-chat `AssistantMessageEvent`s in btw-chat.ts.
// `toolcall_*` SDK events are deliberately NOT forwarded — BTW declares
// tools but never executes them, so the final assistant message simply
// carries the toolCall block (rendered as a "declared, not executed" chip).

import type { AgentMessage } from "@/lib/shared/types";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { startBtwChat, type BtwChatHandle, type BtwToolSpec } from "@/lib/server/btw-chat";
import { runWithLlmAuditContext } from "@/lib/server/llm-audit";

export const dynamic = "force-dynamic";

const log = createLogger("api/btw/send");
type BtwThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface BtwSendRequestBody {
  mainSessionId?: unknown;
  /** Optional, used only for audit attribution — the pure-chat model call
   *  itself never touches the filesystem. */
  cwd?: unknown;
  systemPrompt?: unknown;
  thinkingLevel?: unknown;
  /** Continuation history (the BTW record's own user/assistant pairs) —
   *  required when `isInitialContext` is false. On the FIRST send the
   *  server re-reads the main session's live transcript instead. */
  messages?: unknown;
  userMessage?: unknown;
  isInitialContext?: unknown;
  toolNames?: unknown;
}

/** Snapshot the BTW panel needs from the live main session: the exact
 *  systemPrompt / thinkingLevel / tools / messages the main agent would
 *  send next. Absent when the wrapper isn't alive (no main agent spun up)
 *  or the session was just deleted. */
interface BtwContextSnapshot {
  model: { provider: string; id: string } | null;
  systemPrompt: string;
  thinkingLevel: string;
  tools: BtwToolSpec[];
  messages: unknown[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function validateRequest(body: unknown): {
  mainSessionId: string;
  cwd: string | null;
  messages: AgentMessage[];
  userMessage: AgentMessage;
  isInitialContext: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }
  const b = body as BtwSendRequestBody;

  const mainSessionId = asString(b.mainSessionId, "mainSessionId");
  const cwd = typeof b.cwd === "string" && b.cwd.length > 0 ? b.cwd : null;

  if (!b.userMessage || typeof b.userMessage !== "object") {
    throw new Error("userMessage is required");
  }
  const userMessage = b.userMessage as AgentMessage;

  const isInitialContext = b.isInitialContext === true;
  if (!isInitialContext && !Array.isArray(b.messages)) {
    throw new Error("messages is required for continued BTW turns");
  }
  const messages = isInitialContext ? [] : (b.messages as AgentMessage[]);

  return {
    mainSessionId,
    cwd,
    messages,
    userMessage,
    isInitialContext,
  };
}

/** Pull the main session's live model-request snapshot off the running
 *  wrapper. Returns null when the wrapper isn't alive or the snapshot is
 *  unusable — the caller surfaces a soft 409 so the user can re-ask once
 *  the main session is loaded. */
async function fetchBtwContext(mainSessionId: string): Promise<BtwContextSnapshot | null> {
  try {
    const { getRpcSession } = await import("@/lib/server/rpc-manager");
    const wrapper = getRpcSession(mainSessionId);
    if (!wrapper?.isAlive()) return null;
    const snapshot = (await wrapper.send({ type: "btw_context" })) as BtwContextSnapshot | null;
    if (!snapshot) return null;
    return {
      model: snapshot.model ?? null,
      systemPrompt: typeof snapshot.systemPrompt === "string" ? snapshot.systemPrompt : "",
      thinkingLevel: typeof snapshot.thinkingLevel === "string" ? snapshot.thinkingLevel : "off",
      tools: Array.isArray(snapshot.tools) ? snapshot.tools : [],
      messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
    };
  } catch (error) {
    log.warn("fetchBtwContext via wrapper failed", {
      mainSessionId,
      error: String(error),
    });
    return null;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed: ReturnType<typeof validateRequest>;
  try {
    parsed = validateRequest(body);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }

  // Authoritative source for model / systemPrompt / thinkingLevel / tools /
  // first-send context: the live main session. Continuation history comes
  // from the client (`parsed.messages`).
  const snapshot = await fetchBtwContext(parsed.mainSessionId);
  if (!snapshot) {
    log.warn("btw send: main session unavailable", {
      mainSessionId: parsed.mainSessionId,
      durationMs: elapsedMs(startedAt),
    });
    return Response.json(
      { error: "Main session is not available; please open the main session first." },
      { status: 409 },
    );
  }
  if (!snapshot.systemPrompt || !snapshot.model) {
    log.warn("btw send: main session not ready (no system prompt / model)", {
      mainSessionId: parsed.mainSessionId,
      durationMs: elapsedMs(startedAt),
    });
    return Response.json(
      { error: "Main session system prompt unavailable; please open the main session first." },
      { status: 409 },
    );
  }

  const thinkingLevels: BtwThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const thinkingLevel = thinkingLevels.includes(snapshot.thinkingLevel as BtwThinkingLevel)
    ? (snapshot.thinkingLevel as BtwThinkingLevel)
    : "off";

  const model = { provider: snapshot.model.provider, modelId: snapshot.model.id };

  // Context assembly:
  //   - First send: the main session's live transcript (SDK shape) — the
  //     exact array the main agent would send next, so provider prompt
  //     caching carries over.
  //   - Continuation: the BTW record's own history from the client.
  const contextMessages = parsed.isInitialContext
    ? snapshot.messages
    : parsed.messages;

  const encoder = new TextEncoder();
  let chat: BtwChatHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
        if (chat) {
          try { chat.dispose(); } catch { /* ignore */ }
          chat = null;
        }
        try { controller.close(); } catch { /* already closed */ }
      };

      // 30s heartbeat — keeps corporate proxies from reaping the
      // connection. Same window as the main `/api/agent/[id]/events`
      // and `/api/translate` routes.
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(":\n\n")); } catch { closed = true; }
      }, 30_000);

      req.signal?.addEventListener("abort", cleanup, { once: true });

      try {
        // Run startBtwChat inside the LLM-audit ALS so every fetch the SDK
        // makes is stamped `source: "btw"` and attributed to this session.
        const handle = await runWithLlmAuditContext(
          {
            sessionId: parsed.mainSessionId,
            source: "btw",
            cwd: parsed.cwd,
            sessionName: null,
          },
          () => startBtwChat({
            mainSessionId: parsed.mainSessionId,
            model,
            systemPrompt: snapshot.systemPrompt,
            thinkingLevel,
            contextMessages,
            tools: snapshot.tools,
            userMessage: parsed.userMessage,
            signal: req.signal ?? new AbortController().signal,
          }),
        );
        chat = handle;

        log.info("btw stream connected", {
          mainSessionId: parsed.mainSessionId,
          cwd: parsed.cwd,
          model,
          isInitialContext: parsed.isInitialContext,
          contextMessages: contextMessages.length,
          tools: snapshot.tools.length,
          thinkingLevel,
          durationMs: elapsedMs(startedAt),
        });

        // Surface a `connected` event so the client can distinguish
        // "stream ready" from "request accepted". Mirrors the main
        // agent event route.
        send({ type: "connected" });

        unsubscribe = handle.subscribe((event) => {
          const evt = event as { type?: unknown } | null;
          if (!evt || typeof evt.type !== "string") return;
          if (evt.type === "agent_end" || evt.type === "agent_settled") {
            // Forward the terminal event then close. Anything after is
            // dropped by the cleanup pass.
            send(evt);
            cleanup();
            return;
          }
          send(evt);
        });

        // Start only after the subscriber is installed. This ordering is
        // essential: a fast model can emit the complete turn synchronously
        // enough for subscribe-after-start to lose the terminal event and
        // leave the browser waiting forever.
        handle.start();
      } catch (error) {
        log.error("btw chat start failed", {
          mainSessionId: parsed.mainSessionId,
          error,
          durationMs: elapsedMs(startedAt),
        });
        send({ type: "error", message: String(error) });
        cleanup();
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
      if (chat) {
        try { chat.abort().catch(() => {}); } catch { /* ignore */ }
        try { chat.dispose(); } catch { /* ignore */ }
        chat = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}