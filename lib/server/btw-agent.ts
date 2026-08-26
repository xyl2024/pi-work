// ── BTW temporary-agent lifecycle ──────────────────────────────────────
//
// The BTW panel needs a model call grounded in the active session's
// context, but it must NOT participate in the main session's lifecycle:
//
//   - No JSONL writes (per handoff §1 + §7 "红线")
//   - No entry into the RPC registry / wrapper
//   - No tool set beyond read / grep / ls / find
//   - No extension hooks, no auto-compaction, no pi-internal tools
//   - No persistence — `SessionManager.inMemory()`, no `sessionFile`
//
// So we construct our own `AgentSession` via the SDK directly and dispose
// it on every terminal event (success / abort / error). The system
// prompt is the *main session's* current prompt (handoff §2 #11) so the
// BTW answers share the same identity / instructions as the main agent.
// The active tool set is locked to the read-only whitelist at construction
// time and never loosened — `setActiveToolsByName` is the only way to
// touch it and we never call it again.
//
// LLM API audit calls are stamped with `source: "btw"` via
// `runWithLlmAuditContext` so they show up as a distinct stream in the
// LLM API audit panel (handoff §2 #24).

import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { createLogger } from "./logger";
import { runWithLlmAuditContext } from "./llm-audit";
import { readConfig } from "./config";
import { readEnabledCustomTools } from "./custom-tools-config";
import { readEnabledTodoTools } from "./user-todo/tools-config";
import { buildTodoTools } from "./user-todo/tools";
import { buildShowFileTool } from "./show-file-tool";
import { buildAgentTodoTool, AGENT_TODO_SYSTEM_PROMPT_BLOCK } from "./agent-todo-tool/tool";
import { buildAskUserQuestionsTool } from "./ask-user-questions-tool";
import type { AgentMessage } from "../shared/types";

const log = createLogger("btw-agent");
type BtwThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface BtwAgentRequest {
  /** The active main session id, used only for audit attribution. */
  mainSessionId: string;
  /** The main session's current `cwd` — snapshotted at send time. */
  cwd: string;
  /** Provider/model resolved against the runtime. */
  model: { provider: string; modelId: string };
  /** The **main session's** current effective system prompt. Re-used
   *  verbatim per handoff §2 #11 (no BTW-specific prefix). */
  systemPrompt: string;
  /**
   * First call (no prior BTW history): the full main-session context,
   * including all prior `user`/`assistant`/`toolResult` messages, in
   * the exact shape `agent.state.messages` accepts. The new user
   * message is appended below.
   *
   * Continuation: the BTW record's `messages` (user + assistant pairs
   * only — no need to re-send the main session context). The new user
   * message is appended at the end.
   */
  contextMessages: AgentMessage[];
  /** Active tools copied from the main session. */
  toolNames: string[];
  /** Thinking level copied from the main session. */
  thinkingLevel: BtwThinkingLevel;
  /** New user turn appended to `contextMessages`. The server-side
   *  prompt call replaces whatever the agent's prior state held, so
   *  the caller is responsible for building the full pre-prompt
   *  `messages` list. */
  userMessage: AgentMessage;
  /** Cancellation signal wired up to the client fetch's `req.signal`. */
  signal: AbortSignal;
}

/** One-shot helper used by the SSE route. Returns an async iterator
 *  that yields SDK events for as long as the request is alive; the
 *  caller forwards them as SSE messages and disposes the agent when
 *  the stream ends or aborts. Errors are surfaced through the final
 *  `agent_end` / `error` events, not as iterator throws, so the SSE
 *  pipeline can serialise them. */
export interface BtwAgentHandle {
  /** SDK event subscription (mirror of `AgentSession.subscribe`). The
   *  caller MUST unsubscribe before disposing to avoid late events
   *  racing with the cleanup. */
  subscribe(listener: (event: unknown) => void): () => void;
  /** Abort the in-flight prompt. Idempotent. Safe to call multiple
   *  times (e.g. user-click "stop" + client fetch abort). */
  abort(): Promise<void>;
  /** Start the prompt. Must be called after subscribe() so no early events
   *  can be lost. Idempotent; a disposed handle cannot be started. */
  start(): void;
  /** Tear down the agent: unsubscribe, abort, dispose. Always safe to
   *  call more than once — the wrapper guards against double-dispose.
   *  After dispose(), no further events will fire. */
  dispose(): void;
}

interface StartedAgent {
  session: AgentSession;
  /** Direct ref to the runtime, kept alongside the session so cleanup
   *  is single-step and we never leak the in-memory SessionManager. */
  unsubscribers: Set<() => void>;
}

/** Renaming map for a single `toolCall` content block: our
 *  `lib/shared/types.ToolCallContent` uses
 *  `{ toolCallId, toolName, input }`; the SDK expects
 *  `{ id, name, arguments, thoughtSignature?, namespace? }`. We do the
 *  field rename here so the LLM provider sees a well-formed `tool_use`
 *  block — see the comment on `state.messages = ...` for the full
 *  failure mode this prevents. The `id` fallback (`toolCallId` first,
 *  then `id`, then `""`) tolerates transcripts where either field is
 *  already populated (e.g. a continuation turn whose BTW history was
 *  written by an older hook). */
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

/** Normalise an assistant message's `content[]` blocks so every
 *  `toolCall` block uses the SDK's `{ id, name, arguments }` shape.
 *  Other block kinds (text, thinking, image) are passed through. */
function renameAssistantContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  return content.map((block) => renameToolCallBlock(block));
}

/** Convert our `lib/shared/types.AgentMessage[]` shape into the SDK's
 *  `AgentMessage[]` shape. Renames toolCall field names and backfills
 *  provider/model on assistant messages so the LLM provider's
 *  `transformMessages` pass doesn't trip over missing fields.
 *
 *  Returns a new array; the input is not mutated. */
function normalizeContextForSdk(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const a = m as AgentMessage & {
        provider?: unknown;
        model?: unknown;
        api?: unknown;
      };
      return {
        ...a,
        provider: typeof a.provider === "string" ? a.provider : "",
        model: typeof a.model === "string" ? a.model : "",
        api: typeof a.api === "string" ? a.api : "",
        content: renameAssistantContent((a as { content?: unknown }).content),
      };
    }
    if (m.role === "toolResult") {
      // ToolResult already uses `toolCallId` in both shapes; the SDK
      // requires `toolName` to be a string. Backfill from existing
      // fields or leave empty — an empty toolName is harmless because
      // the LLM provider matches by `toolCallId`, not by name.
      const t = m as AgentMessage & { toolName?: unknown; isError?: unknown; timestamp?: unknown };
      return {
        ...t,
        toolName: typeof t.toolName === "string" ? t.toolName : "",
        isError: typeof t.isError === "boolean" ? t.isError : false,
        timestamp: typeof t.timestamp === "number" ? t.timestamp : Date.now(),
      };
    }
    return m;
  });
}

export async function startBtwAgent(req: BtwAgentRequest): Promise<BtwAgentHandle> {
  const agentDir = path.join(process.env.HOME ?? "", ".pi", "agent");
  const startedAt = Date.now();

  // Resolve the model on a ModelRuntime that has been wrapped by the
  // LLM-audit infrastructure so every fetch call is stamped with the
  // "btw" source. Reuse `getAuditModelRuntime` from llm-audit.ts to
  // keep the patch list and host allowlist in sync with the main agent.
  const { getAuditModelRuntime, installLlmFetchAudit } = await import("./llm-audit");
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

  // Re-use the SDK's DefaultResourceLoader so the same skill / extension
  // / prompt / theme discovery pipeline applies — but pass an explicit
  // `systemPrompt` override that pins BTW to the **main session's**
  // current system prompt verbatim. We deliberately do NOT append any
  // BTW-specific block (§2 #11). Skills / append prompts / agents files
  // are still discovered from `~/.pi/agent/` and the cwd, matching how
  // the main session sees the world.
  const enabledCustom = readEnabledCustomTools();
  let appendSystemPrompt: string[] | undefined;
  try {
    if (!readConfig().append_system.enabled) appendSystemPrompt = [];
  } catch {
    // readConfig already applies its fail-safe defaults.
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd: req.cwd,
    agentDir,
    ...(appendSystemPrompt !== undefined ? { appendSystemPrompt } : {}),
    appendSystemPromptOverride: (baseAppend: string[]) =>
      enabledCustom.has("agent_todo")
        ? [...baseAppend, AGENT_TODO_SYSTEM_PROMPT_BLOCK]
        : baseAppend,
  });
  await resourceLoader.reload();

  const agentRuntime = await createAgentSession({
    cwd: req.cwd,
    agentDir,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({}),
    resourceLoader,
    modelRuntime,
    model,
    thinkingLevel: req.thinkingLevel,
    tools: req.toolNames,
    customTools: [
      ...buildTodoTools(readEnabledTodoTools()),
      ...(enabledCustom.has("show_media") || enabledCustom.has("show_file")
        ? buildShowFileTool()
        : []),
      ...(enabledCustom.has("agent_todo") ? buildAgentTodoTool() : []),
      ...(enabledCustom.has("ask_user_questions")
        ? buildAskUserQuestionsTool({ source: "user" })
        : []),
    ],
  });
  const session: AgentSession = agentRuntime.session;
  if (!session || typeof session.subscribe !== "function") {
    throw new Error("createAgentSession did not return an AgentSession");
  }

  // Keep BTW's system prompt aligned with the main session after the SDK
  // applies the selected tool set.
  session.setThinkingLevel(req.thinkingLevel);

  // Per handoff §2 #11: BTW uses the **main session's** original system
  // prompt verbatim, no BTW-specific prefix. The SDK computed a
  // tool-set-specific prompt above; we replace it before the first
  // `prompt()` call. We deliberately do NOT call `setActiveToolsByName`
  // afterwards because that would trigger another `_rebuildSystemPrompt`
  // pass inside the SDK and overwrite this override.
  session.agent.state.systemPrompt = req.systemPrompt;

  const started: StartedAgent = {
    session,
    unsubscribers: new Set(),
  };

  // Build the agent's pre-prompt messages: the caller-prepared context
  // (main session context for the first send, BTW history for later
  // sends). The new user message is sent via `prompt()` below. The SDK's
  // `AgentMessage` union is structurally compatible with our shared
  // `lib/shared/types` shape (the runtime only inspects `role` +
  // `content` discriminants); the few field-level differences
  // (`ImageContent.source` vs `data`/`mimeType`) don't matter here
  // because BTW user messages are plain strings — the SDK's `prompt()`
  // call serialises the new text and never sees an ImageContent through
  // this code path. We cast at the boundary to avoid a translation layer
  // Convert our `lib/shared/types` `AgentMessage` shape into the SDK's
  // `AgentMessage` shape before assigning it to `state.messages`.
  //
  // Two divergences matter for BTW:
  //
  // 1. `ToolCallContent` field names: our shape uses
  //    `{ toolCallId, toolName, input }`; the SDK (and its downstream
  //    LLM provider serializer in `transform-messages.js`) reads
  //    `{ id, name, arguments }` off the same block. If we pass our
  //    shape through unchanged, the LLM API sees a `tool_use` block
  //    with no `id`, and any subsequent `toolResult.tool_call_id` can
  //    no longer resolve to a real tool call — exactly the error
  //    `tool result's tool id ... not found` users see when their main
  //    session's transcript is forwarded verbatim.
  //
  // 2. `AssistantMessage` provider/model/api fields: the SDK
  //    `transformMessages` pass treats assistant messages as a typed
  //    shape; missing `provider`/`model` doesn't crash but trips
  //    provider-specific serializers. We fill them with empty strings
  //    when missing so the LLM call still goes out cleanly.
  //
  // ImageContent shape (our `source: { data, media_type }` vs the SDK's
  // flat `data`/`mimeType`) does NOT matter here because the BTW hook
  // never sends an ImageContent through this path — user turns are
  // always plain text strings.
  //
  // See `shared/normalize.ts` for the same id/name/arguments renaming
  // done at render time; this server-side normaliser is the SDK-bound
  // twin so the LLM API receives a well-formed transcript.
  const messages = normalizeContextForSdk(req.contextMessages);
  (session.state.messages as unknown) = messages;

  // Abort handling. The client signals abort via `req.signal`; we
  // forward it to the agent's `abort()` so the model call cancels and
  // the SDK emits its terminal `agent_end` event. Multiple abort paths
  // (user click + fetch disconnect) are coalesced by addEventListener.
  const onAbort = () => {
    session.abort().catch((error) => {
      log.warn("btw agent abort failed", { error: String(error) });
    });
  };
  if (req.signal.aborted) {
    onAbort();
  } else {
    req.signal.addEventListener("abort", onAbort, { once: true });
  }

  // The prompt is deliberately started by handle.start() below, after the
  // route has attached its SSE subscriber. Starting it here would create a
  // race where fast responses emit terminal events before subscribe().
  const userText = typeof req.userMessage.content === "string"
    ? req.userMessage.content
    : req.userMessage.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");

  log.info("btw agent prepared", {
    cwd: req.cwd,
    model: { provider: req.model.provider, id: req.model.modelId },
    contextMessages: req.contextMessages.length,
    durationMs: Date.now() - startedAt,
  });

  let disposed = false;
  let startedPrompt = false;
  return {
    start() {
      if (disposed || startedPrompt) return;
      startedPrompt = true;
      // Fire the prompt only after the caller has subscribed. Errors during
      // prompt are surfaced by the SDK event stream; keep the promise
      // handled so no unhandled rejection can escape the request.
      void runWithLlmAuditContext(
        {
          // Keep BTW calls associated with the active main session so the
          // session-bound audit panel can display them together with the
          // source=btw filter.
          sessionId: req.mainSessionId,
          source: "btw",
          cwd: req.cwd,
          sessionName: null,
        },
        async () => {
          try {
            await session.prompt(userText);
          } catch (error) {
            log.debug("btw prompt finished", {
              error: String(error),
              durationMs: Date.now() - startedAt,
            });
          }
        },
      );
    },
    subscribe(listener) {
      if (disposed) return () => {};
      const unsub = session.subscribe((event) => {
        try {
          listener(event);
        } catch (error) {
          log.warn("btw listener threw", { error: String(error) });
        }
      });
      started.unsubscribers.add(unsub);
      return () => {
        unsub();
        started.unsubscribers.delete(unsub);
      };
    },
    async abort() {
      try {
        await session.abort();
      } catch (error) {
        log.warn("btw abort failed", { error: String(error) });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsub of started.unsubscribers) {
        try { unsub(); } catch { /* ignore */ }
      }
      started.unsubscribers.clear();
      try {
        session.abort();
      } catch {
        // ignore — the agent may already be in a terminal state
      }
      try {
        session.dispose();
      } catch (error) {
        log.warn("btw dispose failed", { error: String(error) });
      }
      req.signal.removeEventListener("abort", onAbort);
    },
  };
}