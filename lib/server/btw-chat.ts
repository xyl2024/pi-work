// ── BTW pure-chat lifecycle ─────────────────────────────────────────────
//
// The BTW panel asks the model a question grounded in the active session's
// context WITHOUT booting an agent. Per product decision (方案 B):
//
//   - model / thinking level / system prompt / tools / context are reused
//     VERBATIM from the main session, so the provider request shares the
//     main session's prompt-cache prefix. `sessionId` is also forwarded so
//     cache-aware backends key on the same session.
//   - tools are DECLARED to the model but never executed. If the model
//     emits a `tool_use` block, the turn simply ends there: the UI renders
//     the call chip without a result row ("declared, not executed").
//   - no JSONL writes, no RPC registry entry, no extension hooks, no
//     auto-compaction, no persistence beyond localStorage (client-side).
//
// The SDK's `ModelRuntime.streamSimple` is the pure-chat path: it takes the
// same `{ systemPrompt, messages, tools }` Context the agent loop would
// build and streams `AssistantMessageEvent`s, with zero agent machinery.
// The route maps those events onto the SSE protocol `hooks/useBtw.ts`
// already understands (`message_update` / `message_end` / `agent_end` /
// `error`), so the client is unchanged apart from a slimmer request body.
//
// LLM API audit calls are stamped with `source: "btw"` via the shared
// audit ModelRuntime + fetch patch, so they show up in the LLM API audit
// panel just like the old temporary-agent calls did.

import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger";
import { getAuditModelRuntime, installLlmFetchAudit, runWithLlmAuditContext } from "./llm-audit";
import type { AgentMessage } from "../shared/types";

const log = createLogger("btw-chat");
type BtwThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Read-only projection of the main session's active tools — the same
 *  name/description/parameters the main agent's requests serialize, so the
 *  provider prompt-cache prefix matches byte-for-byte. `execute`/`label` are
 *  dropped: BTW declares tools but never runs them. */
export interface BtwToolSpec {
  name: string;
  description: string;
  parameters: unknown;
  constrainedSampling?: unknown;
}

export interface BtwChatRequest {
  /** The active main session id — used for prompt-cache session affinity
   *  and LLM-audit attribution. */
  mainSessionId: string;
  /** Provider/model resolved against the runtime. */
  model: { provider: string; modelId: string };
  /** The **main session's** current effective system prompt, verbatim
   *  (fetched from the live wrapper, not rebuilt). */
  systemPrompt: string;
  /** Thinking level copied from the main session (fetched live). */
  thinkingLevel: BtwThinkingLevel;
  /**
   * Context messages WITHOUT the new user turn, oldest first:
   *   - first send: the main session's live `agent.state.messages`
   *     (SDK shape, incl. thinking signatures) — the exact array the main
   *     agent would send next;
   *   - continuation: the BTW record's own user/assistant pairs (our
   *     shared shape, normalised to SDK shape here).
   */
  contextMessages: unknown[];
  /** Main session's active tool declarations (never executed). */
  tools: BtwToolSpec[];
  /** New user turn appended to `contextMessages`. */
  userMessage: AgentMessage;
  /** Cancellation wired to the client fetch's `req.signal`. */
  signal: AbortSignal;
}

/** Mirrors the old `BtwAgentHandle` contract so the SSE route's cleanup
 *  logic is unchanged. */
export interface BtwChatHandle {
  /** Event subscription. The caller MUST subscribe before `start()`. */
  subscribe(listener: (event: unknown) => void): () => void;
  /** Abort the in-flight model call. Idempotent. */
  abort(): Promise<void>;
  /** Start the pure-chat stream. Idempotent; no-op after dispose. */
  start(): void;
  /** Tear down: unsubscribe, abort, drop listeners. Idempotent. */
  dispose(): void;
}

/** Renaming map for a single `toolCall` content block: our
 *  `lib/shared/types.ToolCallContent` uses `{ toolCallId, toolName, input }`;
 *  the SDK expects `{ id, name, arguments }`. We do the field rename here so
 *  the LLM provider sees a well-formed `tool_use` block. Idempotent for
 *  SDK-shaped input, and tolerant of either field set (continuations can
 *  carry history written by older hooks). */
function renameToolCallBlock(block: unknown): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as Record<string, unknown>;
  if (b.type !== "toolCall") return block;
  const id = typeof b.id === "string" && b.id.length > 0
    ? b.id
    : typeof b.toolCallId === "string"
      ? b.toolCallId
      : "";
  const name = typeof b.name === "string" && b.name.length > 0
    ? b.name
    : typeof b.toolName === "string"
      ? b.toolName
      : "";
  const arguments_ = b.arguments !== undefined
    ? b.arguments
    : b.input !== undefined
      ? b.input
      : {};
  const out: Record<string, unknown> = {
    type: "toolCall",
    id,
    name,
    arguments: arguments_,
  };
  if (typeof b.thoughtSignature === "string") out.thoughtSignature = b.thoughtSignature;
  if (typeof b.namespace === "string") out.namespace = b.namespace;
  return out;
}

/** Normalise an assistant message's `content[]` blocks so every `toolCall`
 *  block uses the SDK's `{ id, name, arguments }` shape. Pass-through for
 *  everything else (text / thinking / image). */
function renameAssistantContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  return content.map((block) => renameToolCallBlock(block));
}

/** Normalise a user message's `content`: a bare string becomes a
 *  `[{ type: "text", text }]` block array, mirroring the main agent loop's
 *  `normalizePromptInput` (pi-agent-core agent.js) so the LLM provider sees
 *  the exact same message shape as the main session — the fast path for the
 *  first-send snapshot (SDK-shaped, already block content) is untouched. */
function normalizeUserContent(content: unknown): unknown {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

/** Convert our `lib/shared/types.AgentMessage[]` shape into the SDK's
 *  `AgentMessage[]` shape. Renames toolCall field names and backfills
 *  provider/model on assistant messages so the LLM provider's message
 *  transform pass doesn't trip over missing fields. Idempotent on SDK-shaped
 *  input (main-session state). Returns a new array; input is not mutated. */
function normalizeContextForSdk(messages: unknown[]): unknown[] {
  return messages.map((m) => {
    const rec = m as Record<string, unknown>;
    if (rec.role === "assistant") {
      return {
        ...rec,
        provider: typeof rec.provider === "string" ? rec.provider : "",
        model: typeof rec.model === "string" ? rec.model : "",
        api: typeof rec.api === "string" ? rec.api : "",
        content: renameAssistantContent(rec.content),
      };
    }
    if (rec.role === "toolResult") {
      // ToolResult already uses `toolCallId` in both shapes; the SDK
      // requires `toolName` to be a string. Backfill from existing fields
      // or leave empty — an empty toolName is harmless because the LLM
      // provider matches by `toolCallId`, not by name.
      return {
        ...rec,
        toolName: typeof rec.toolName === "string" ? rec.toolName : "",
        isError: typeof rec.isError === "boolean" ? rec.isError : false,
        timestamp: typeof rec.timestamp === "number" ? rec.timestamp : Date.now(),
      };
    }
    if (rec.role === "user") {
      // Mirror the main agent loop's normalizePromptInput: a bare string
      // user turn becomes a `[{ type: "text", text }]` block array so the
      // LLM provider request is byte-identical in shape to the main
      // session's (prompt-cache prefix alignment). First-send snapshot
      // messages already carry block content and pass through unchanged.
      return { ...rec, content: normalizeUserContent(rec.content) };
    }
    return m;
  });
}

export async function startBtwChat(req: BtwChatRequest): Promise<BtwChatHandle> {
  // Prefer PI_CODING_AGENT_DIR so an isolated instance (dev vs prod) never
  // inherits the other instance's auth/models.
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ||
    path.join(process.env.HOME ?? "", ".pi", "agent");
  const startedAt = Date.now();

  // Resolve the model on the audit-wrapped ModelRuntime so the fetch call is
  // stamped `source: "btw"`. `installLlmFetchAudit` is idempotent-per-HMR.
  installLlmFetchAudit();
  const modelRuntime = getAuditModelRuntime(
    await ModelRuntime.create({
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"),
    }),
  );
  const model = modelRuntime.getModel(req.model.provider, req.model.modelId);
  if (!model) {
    throw new Error(`Model not available: ${req.model.provider}/${req.model.modelId}`);
  }

  // Abort plumbing: the route passes `req.signal`; we route it through an
  // internal controller so `abort()` (idempotent, callable by cleanup paths)
  // behaves identically to a client disconnect.
  const controller = new AbortController();
  const onReqAbort = () => controller.abort();
  if (req.signal.aborted) {
    controller.abort();
  } else {
    req.signal.addEventListener("abort", onReqAbort, { once: true });
  }

  const listeners = new Set<(event: unknown) => void>();
  let disposed = false;
  let started = false;

  const emit = (event: unknown) => {
    if (disposed) return;
    for (const l of [...listeners]) {
      try {
        l(event);
      } catch (error) {
        log.warn("btw listener threw", { error: String(error) });
      }
    }
  };

  // The full pre-prompt message list: caller-prepared context (main-session
  // state on the first send, BTW history on continuations) + the new user
  // turn. Normalised to SDK shape unconditionally — idempotent for the
  // SDK-shaped first-send context.
  const messages = normalizeContextForSdk([...req.contextMessages, req.userMessage]);

  const streamOptions: Record<string, unknown> = {
    ...(req.thinkingLevel === "off" ? {} : { reasoning: req.thinkingLevel }),
    sessionId: req.mainSessionId,
    signal: controller.signal,
  };

  log.info("btw chat prepared", {
    cwd: null,
    model: { provider: req.model.provider, id: req.model.modelId },
    contextMessages: req.contextMessages.length,
    tools: req.tools.length,
    thinkingLevel: req.thinkingLevel,
    durationMs: Date.now() - startedAt,
  });

  const handle: BtwChatHandle = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async abort() {
      controller.abort();
    },
    start() {
      if (disposed || started) return;
      started = true;
      void runWithLlmAuditContext(
        {
          // Keep BTW calls associated with the active main session so the
          // session-bound audit panel displays them with the source=btw filter.
          sessionId: req.mainSessionId,
          source: "btw",
          cwd: null,
          sessionName: null,
        },
        async () => {
          try {
            const stream = modelRuntime.streamSimple(
              model,
              {
                systemPrompt: req.systemPrompt,
                messages,
                tools: req.tools,
              } as never,
              streamOptions as never,
            );
            for await (const event of stream) {
              if (disposed) break;
              switch (event.type) {
                case "start":
                  break;
                case "text_start":
                case "text_delta":
                  emit({
                    type: "message_update",
                    assistantMessageEvent: {
                      type: event.type,
                      contentIndex: event.contentIndex,
                      delta: event.type === "text_start" ? "" : event.delta,
                    },
                  });
                  break;
                case "thinking_start":
                case "thinking_delta":
                  emit({
                    type: "message_update",
                    assistantMessageEvent: {
                      type: event.type,
                      contentIndex: event.contentIndex,
                      delta: event.type === "thinking_start" ? "" : event.delta,
                    },
                  });
                  break;
                case "text_end":
                case "thinking_end":
                  // Final text/thinking is delivered by `done`; nothing to do.
                  break;
                case "toolcall_start":
                case "toolcall_delta":
                  // Tools are never executed — no live updates to stream.
                  // The call chip renders from the final message content.
                  break;
                case "toolcall_end":
                  // Same: the final `message_end` carries the toolCall block,
                  // which the client's normalizeToolCalls converts to our
                  // {toolCallId, toolName, input} shape for the collapsed chip.
                  break;
                case "done": {
                  emit({ type: "message_end", message: event.message });
                  emit({
                    type: "agent_end",
                    stopReason: event.reason,
                    usage: event.message.usage,
                  });
                  return;
                }
                case "error": {
                  // Mid-stream provider error — mirror the old agent flow:
                  // a failure-shaped assistant message (renders the error
                  // banner) followed by agent_end (client persists the pair).
                  const failure = event.error.errorMessage ?? event.reason;
                  emit({
                    type: "message_end",
                    message: {
                      role: "assistant",
                      content: [],
                      provider: model.provider,
                      model: model.id,
                      stopReason: event.reason ?? "error",
                      errorMessage: failure,
                      timestamp: Date.now(),
                    },
                  });
                  emit({ type: "agent_end", stopReason: event.reason ?? "error" });
                  return;
                }
                default:
                  break;
              }
            }
            // Stream ended without a terminal event (abort / unexpected
            // close). The client's fetch-abort path covers user-initiated
            // stops; a silent truncation is surfaced by the client as a
            // network error, matching the old behaviour.
          } catch (error) {
            if (controller.signal.aborted) {
              // User "Stop" or client disconnect — discard, client handles it.
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            log.warn("btw chat stream failed", {
              mainSessionId: req.mainSessionId,
              error: message,
              durationMs: Date.now() - startedAt,
            });
            emit({ type: "error", error: message });
          }
        },
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      controller.abort();
      req.signal.removeEventListener("abort", onReqAbort);
    },
  };
  return handle;
}