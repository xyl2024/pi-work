// ── POST /api/btw/send ─────────────────────────────────────────────────
//
// SSE endpoint for the BTW (By the way) right-side panel. Each request
// spins up a throwaway in-memory agent (`lib/server/btw-agent.ts`),
// streams its events back to the browser, and disposes the agent on
// every terminal condition (success / abort / error / client disconnect).
//
// Per the handoff §3.5, the wire format mirrors `/api/agent/[id]/events`
// and `/api/translate/route.ts`: each event is `data: <json>\n\n`, plus
// a 30s heartbeat (`:\n\n`) to keep proxies from killing the stream.
//
// The response is "the agent's stream of events" — same `type` strings
// the main agent emits (`message_start` / `message_update` /
// `message_end` / `tool_execution_start` / `tool_execution_update` /
// `tool_execution_end` / `agent_end` / `prompt_failed`). The client
// reconstructs an `AssistantMessage` / `ToolResultMessage` from these,
// which it can hand to the same `MessageView` it uses for the main
// session.

import type { AgentMessage } from "@/lib/shared/types";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { startBtwAgent, type BtwAgentHandle } from "@/lib/server/btw-agent";
import { runWithLlmAuditContext } from "@/lib/server/llm-audit";

export const dynamic = "force-dynamic";

const log = createLogger("api/btw/send");
type BtwThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface BtwSendRequestBody {
  mainSessionId?: unknown;
  cwd?: unknown;
  model?: { provider?: unknown; modelId?: unknown };
  /** The main session's current effective system prompt — passed
   *  through verbatim to the BTW agent (handoff §2 #11). */
  systemPrompt?: unknown;
  thinkingLevel?: unknown;
  messages?: unknown;
  userMessage?: unknown;
  /** True iff the caller is sending the FIRST BTW turn — i.e. the
   *  `messages` array is the main session's full context, and the
   *  agent should treat it as the conversation's history. */
  isInitialContext?: unknown;
  toolNames?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is required`);
  }
  return value as Record<string, unknown>;
}

function validateRequest(body: unknown): {
  mainSessionId: string;
  cwd: string;
  model: { provider: string; modelId: string };
  systemPrompt: string;
  messages: AgentMessage[];
  userMessage: AgentMessage;
  isInitialContext: boolean;
  toolNames: string[];
  thinkingLevel: BtwThinkingLevel;
} {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }
  const b = body as BtwSendRequestBody;

  const mainSessionId = asString(b.mainSessionId, "mainSessionId");
  const cwd = asString(b.cwd, "cwd");
  const modelObj = asObject(b.model, "model");
  const provider = asString(modelObj.provider, "model.provider");
  const modelId = asString(modelObj.modelId, "model.modelId");
  const systemPrompt = typeof b.systemPrompt === "string" ? b.systemPrompt : "";

  if (!Array.isArray(b.messages)) throw new Error("messages must be an array");
  // Defensive: the messages array can grow large for the first send
  // (full main-session context). The SDK will surface a clean error
  // if it's over the model's window — we forward that on the SSE
  // channel rather than 4xx-ing here, so the client can render the
  // §3.7 "context too large" hint with the same UX as a normal abort.
  const messages = b.messages as AgentMessage[];

  if (!b.userMessage || typeof b.userMessage !== "object") {
    throw new Error("userMessage is required");
  }
  const userMessage = b.userMessage as AgentMessage;

  if (!Array.isArray(b.toolNames)) throw new Error("toolNames is required");
  const toolNames = b.toolNames.map((name) => asString(name, "toolNames[]"));
  const thinkingLevelValue = asString(b.thinkingLevel, "thinkingLevel");
  const thinkingLevels: BtwThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (!thinkingLevels.includes(thinkingLevelValue as BtwThinkingLevel)) throw new Error("invalid thinkingLevel");
  const thinkingLevel = thinkingLevelValue as BtwThinkingLevel;

  const isInitialContext = b.isInitialContext === true;

  return {
    mainSessionId,
    cwd,
    model: { provider, modelId },
    systemPrompt,
    messages,
    userMessage,
    isInitialContext,
    toolNames,
    thinkingLevel,
  };
}

/** Pull the main session's *current* system prompt off the running
 *  wrapper. Falls back to an empty string when:
 *    - the wrapper isn't alive (no main agent has been spun up)
 *    - the wrapper can't be found (e.g. session was just deleted)
 *  The fallback path leaves the BTW agent without a system prompt —
 *  better than refusing the request outright, and the user can re-ask
 *  once the main session is loaded. */
async function resolveSystemPrompt(mainSessionId: string): Promise<string> {
  try {
    const { getRpcSession } = await import("@/lib/server/rpc-manager");
    const wrapper = getRpcSession(mainSessionId);
    if (wrapper?.isAlive()) {
      const state = await wrapper.send({ type: "get_state" });
      const prompt = (state as { systemPrompt?: string } | null)?.systemPrompt;
      if (typeof prompt === "string") return prompt;
    }
  } catch (error) {
    log.warn("resolveSystemPrompt via wrapper failed", {
      mainSessionId,
      error: String(error),
    });
  }
  // Last-resort: read the main session file directly and reconstruct
  // the prompt the kernel would have produced. We deliberately skip
  // this heavy path — empty string is acceptable here because the
  // caller will surface a soft error to the user.
  return "";
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

  const systemPrompt = parsed.systemPrompt || await resolveSystemPrompt(parsed.mainSessionId);
  if (!systemPrompt) {
    log.warn("btw send: no system prompt available", {
      mainSessionId: parsed.mainSessionId,
      durationMs: elapsedMs(startedAt),
    });
    return Response.json(
      { error: "Main session system prompt unavailable; please open the main session first." },
      { status: 409 },
    );
  }

  // Resolve messages to feed into the agent:
  //   - Initial send: the caller sends the main session's full context
  //     as `messages`, and the new user message as `userMessage`. The
  //     agent boots with `messages + userMessage`.
  //   - Continuation: the caller sends the BTW history (BTW's own
  //     user/assistant pairs) and the new user message. Same assembly.
  const contextMessages = parsed.messages;

  const encoder = new TextEncoder();
  let agent: BtwAgentHandle | null = null;
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
        if (agent) {
          try { agent.dispose(); } catch { /* ignore */ }
          agent = null;
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
        // Run startBtwAgent inside the LLM-audit ALS as well. The
        // function itself also runs `runWithLlmAuditContext` for the
        // prompt path, but we set the context here too so any fetch
        // the SDK makes during construction is stamped `source: "btw"`.
        const handle = await runWithLlmAuditContext(
          {
            sessionId: parsed.mainSessionId,
            source: "btw",
            cwd: parsed.cwd,
            sessionName: null,
          },
          () => startBtwAgent({
            mainSessionId: parsed.mainSessionId,
            cwd: parsed.cwd,
            model: parsed.model,
            systemPrompt,
            toolNames: parsed.toolNames,
            thinkingLevel: parsed.thinkingLevel,
            contextMessages,
            userMessage: parsed.userMessage,
            signal: req.signal ?? new AbortController().signal,
          }),
        );
        agent = handle;

        log.info("btw stream connected", {
          mainSessionId: parsed.mainSessionId,
          cwd: parsed.cwd,
          model: parsed.model,
          isInitialContext: parsed.isInitialContext,
          contextMessages: contextMessages.length,
          durationMs: elapsedMs(startedAt),
        });

        // Surface a `connected` event so the client can distinguish
        // "stream ready" from "request accepted". Mirrors the main
        // agent event route.
        send({ type: "connected" });

        unsubscribe = agent.subscribe((event) => {
          const evt = event as { type?: unknown } | null;
          if (!evt || typeof evt.type !== "string") return;
          if (evt.type === "agent_end" || evt.type === "agent_settled") {
            // Forward the terminal event then close. Anything the SDK
            // might emit after this is dropped by the cleanup pass.
            send(evt);
            cleanup();
            return;
          }
          send(evt);
        });

        // Start only after the subscriber is installed. This ordering is
        // essential: a fast model can emit the complete BTW turn
        // synchronously enough for subscribe-after-prompt to lose the
        // terminal event and leave the browser waiting forever.
        agent.start();
      } catch (error) {
        log.error("btw agent start failed", {
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
      if (agent) {
        try { agent.abort().catch(() => {}); } catch { /* ignore */ }
        try { agent.dispose(); } catch { /* ignore */ }
        agent = null;
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