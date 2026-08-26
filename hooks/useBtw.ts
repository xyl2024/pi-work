// ── useBtw ─────────────────────────────────────────────────────────────
//
// State machine for the BTW (By the way) right-side panel. The hook owns:
//
//   - the BTW message history (mirrored from `pi-work:btw:<sessionId>`)
//   - the in-flight send lifecycle (idle → loading → streaming → done/error)
//   - persistence to localStorage on every committed transition
//   - 7-day expiry cleanup on first read (§3.3 of the handoff)
//
// It deliberately stays out of `useAgentSession` — that hook owns the
// MAIN session's RPC events and JSONL writes, and BTW is forbidden
// from touching either. The two live in independent stores.
//
// Persistence model (mirrors `lib/client/btw-storage.ts`):
//   - `user` message is written synchronously to localStorage BEFORE
//     `fetch()` is fired (handoff §3.3 "user 消息在 send 调用前同步写入")
//   - `assistant` is only written when the stream ends cleanly (success
//     or `agent_end` with `stopReason: "error"`) — partial / aborted
//     assistants are dropped
//   - mid-stream cancel / network drop → discard the in-flight assistant,
//     keep the user message that was already on disk
//
// SSE parsing mirrors the main `/api/agent/[id]/events` route:
// `data: {json}\n\n` per event, `:\n\n` heartbeats ignored.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolResultMessage } from "@/lib/shared/types";
import { normalizeToolCalls } from "@/lib/shared/normalize";
import {
  deleteBtw,
  readBtw,
  writeBtw,
  type BtwPersisted,
  BtwStorageQuotaError,
} from "@/lib/client/btw-storage";

/** Public state machine value for the panel. */
export type BtwPhase = "idle" | "loading" | "streaming" | "error";

export interface BtwState {
  /** Persistent BTW messages. The first user message + a single
   *  assistant per turn, in chronological order. */
  messages: AgentMessage[];
  /** Live streaming phase; the panel uses this to gate the input. */
  phase: BtwPhase;
  /** Set when `phase === "error"`. Cleared on the next send. */
  errorMessage?: string;
  /** Per-turn in-flight assistant message — built up from
   *  `message_update` text/thinking deltas. Cleared when the turn ends. */
  streamingMessage: AssistantMessage | null;
  /** Per-tool-call partial results keyed by `toolCallId`. Mirrors the
   *  main chat's `inFlightToolResults`. Cleared on `tool_execution_end`. */
  inFlightToolResults: Map<string, ToolResultMessage>;
}

export interface UseBtwApi extends BtwState {
  /** True iff BTW can be opened at all (a stable main sessionId). */
  enabled: boolean;
  /** Latest user-driven error to surface as a toast / inline. */
  lastError: string | null;
  /** Send a user turn. Persists the user message immediately, then
   *  fires the SSE request. */
  send(text: string): Promise<void>;
  /** Stop the current turn: abort the SSE, drop the in-flight
   *  assistant. The already-written user message stays. */
  stop(): void;
  /** Drop the BTW history for the active main session. Caller is
   *  responsible for any confirmation UI; this hook just persists. */
  clear(): void;
  /** Force a re-read of the BTW history from localStorage. Used after
   *  switching sessions. */
  refresh(): void;
}

export interface UseBtwArgs {
  /** Main session id. When null/undefined, BTW is disabled and the
   *  hook returns an inert API (handoff §2 #14). */
  mainSessionId: string | null;
  /** Main session cwd snapshot at send time. When null, send() refuses
   *  to fire (no cwd = no agent = no BTW). */
  cwd: string | null;
  /** Model snapshot from the main session, in the same shape as
   *  `/api/agent/[id]` returns. When null, send() refuses (handoff
   *  §2 #23). */
  model: { provider: string; modelId: string } | null;
  /** Main session's current effective system prompt — passed through
   *  verbatim to the BTW agent (handoff §2 #11). When null, send()
   *  refuses. */
  systemPrompt: string | null;
  /** Active tools and thinking level copied from the main session. */
  toolNames: string[];
  thinkingLevel: string;
  /** Full main-session messages at the moment the panel is opened;
   *  used to feed the agent on the FIRST send (handoff §3.4). The
   *  hook reads this from a ref so it doesn't need to re-subscribe
   *  on every chat update. */
  getMainSessionMessages?: () => AgentMessage[];
}

interface InternalSendState {
  controller: AbortController;
  /** Live text/thinking/toolcall accumulator for the current
   *  assistant. Reset on agent_start / agent_end. */
  assistant: AssistantMessage;
  /** Live in-flight tool results. */
  toolResults: Map<string, ToolResultMessage>;
}

/** Decoded SSE event. We don't import the SDK type — the SSE route
 *  emits the same wire format the main agent stream uses, but the
 *  client doesn't need the type-safe variants. */
interface BtwSseEvent {
  type: string;
  [key: string]: unknown;
}

const INITIAL_ASSISTANT = (): AssistantMessage => ({
  role: "assistant",
  content: [],
  model: "",
  provider: "",
  timestamp: Date.now(),
});

function appendAssistantDelta(
  assistant: AssistantMessage,
  assistantMessageEvent: { type?: string; contentIndex?: number; delta?: string } | undefined,
): AssistantMessage {
  if (!assistantMessageEvent || typeof assistantMessageEvent.type !== "string") return assistant;
  const contentIndex = typeof assistantMessageEvent.contentIndex === "number"
    ? assistantMessageEvent.contentIndex
    : 0;
  const delta = typeof assistantMessageEvent.delta === "string" ? assistantMessageEvent.delta : "";

  const blocks = [...assistant.content];
  while (blocks.length <= contentIndex) {
    blocks.push({ type: "text", text: "" });
  }
  const block = blocks[contentIndex];
  switch (assistantMessageEvent.type) {
    case "text_start":
      blocks[contentIndex] = { type: "text", text: "" };
      break;
    case "text_delta":
      if (block.type === "text") blocks[contentIndex] = { type: "text", text: block.text + delta };
      break;
    case "text_end":
      // final text is delivered via message_end; nothing to do.
      break;
    case "thinking_start":
      blocks[contentIndex] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta":
      if (block.type === "thinking") blocks[contentIndex] = { type: "thinking", thinking: block.thinking + delta };
      break;
    case "thinking_end":
      break;
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      // Tool-call assembly happens via `tool_execution_*` events; we
      // don't reconstruct tools from message_update deltas here.
      break;
    case "done":
    case "error":
      // Terminal events for the message itself; message_end carries
      // the final shape.
      break;
    default:
      break;
  }
  return { ...assistant, content: blocks };
}

function pushToolCall(
  assistant: AssistantMessage,
  toolCallId: string,
  toolName: string,
  args: unknown,
): AssistantMessage {
  const blocks = [...assistant.content];
  // De-dupe: if the same id already exists, leave it. The SDK can
  // re-emit `tool_execution_start` on retry in some flows.
  if (blocks.some((b) => b.type === "toolCall" && b.toolCallId === toolCallId)) return assistant;
  blocks.push({
    type: "toolCall",
    toolCallId,
    toolName,
    input: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {},
  });
  return { ...assistant, content: blocks };
}

function applyPartialToolResult(
  toolResults: Map<string, ToolResultMessage>,
  toolCallId: string,
  toolName: string | undefined,
  partial: { content?: Array<{ type?: string; text?: string }> } | undefined,
): Map<string, ToolResultMessage> {
  const blocks: { type: "text"; text: string }[] = [];
  if (partial && Array.isArray(partial.content)) {
    for (const b of partial.content) {
      if (b && b.type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: b.text });
    }
  }
  const next = new Map(toolResults);
  const existing = next.get(toolCallId);
  next.set(toolCallId, {
    role: "toolResult",
    toolCallId,
    toolName: toolName ?? existing?.toolName,
    content: blocks.length > 0 ? blocks : (existing?.content ?? []),
    timestamp: existing?.timestamp ?? Date.now(),
  });
  return next;
}

export function useBtw(args: UseBtwArgs): UseBtwApi {
  const { mainSessionId, cwd, model, systemPrompt, toolNames, thinkingLevel, getMainSessionMessages } = args;
  const enabled = !!mainSessionId;

  const [persisted, setPersisted] = useState<BtwPersisted | null>(() =>
    mainSessionId ? readBtw(mainSessionId) : null,
  );
  const [phase, setPhase] = useState<BtwPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [lastError, setLastError] = useState<string | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<AssistantMessage | null>(null);
  const [inFlightToolResults, setInFlightToolResults] = useState<Map<string, ToolResultMessage>>(
    () => new Map(),
  );

  // Internal handles kept off React state to avoid re-render churn on
  // every delta. The current turn's abort controller and accumulator.
  const inFlight = useRef<InternalSendState | null>(null);

  // ── Persistence helpers ────────────────────────────────────────────
  const persist = useCallback((next: BtwPersisted) => {
    try {
      writeBtw(next);
      setPersisted(next);
      setLastError(null);
    } catch (error) {
      if (error instanceof BtwStorageQuotaError) {
        // §3.3 "超出后弹错误提示用户清空（不静默丢消息）"
        const message = error.message;
        setLastError(message);
        setErrorMessage(message);
        setPhase("error");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message);
        setErrorMessage(message);
        setPhase("error");
      }
    }
  }, []);

  const removePersisted = useCallback(() => {
    if (!mainSessionId) return;
    deleteBtw(mainSessionId);
    setPersisted(null);
    setStreamingMessage(null);
    setInFlightToolResults(new Map());
    setErrorMessage(undefined);
    setLastError(null);
    setPhase("idle");
  }, [mainSessionId]);

  // ── Re-read on session change / panel open ──────────────────────────
  useEffect(() => {
    if (!mainSessionId) {
      setPersisted(null);
      setPhase("idle");
      setStreamingMessage(null);
      setInFlightToolResults(new Map());
      setErrorMessage(undefined);
      setLastError(null);
      return;
    }
    const fresh = readBtw(mainSessionId);
    setPersisted(fresh);
    // Mounting / switching to a non-empty BTW shouldn't auto-stream;
    // phase stays idle until the user sends.
    setPhase("idle");
    setStreamingMessage(null);
    setInFlightToolResults(new Map());
    setErrorMessage(undefined);
    setLastError(null);
  }, [mainSessionId]);

  // ── send ────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!mainSessionId || !cwd || !model || !systemPrompt) {
        const why = !mainSessionId
          ? "btw.disabled.noSession"
          : !cwd || !systemPrompt
            ? "btw.disabled.loading"
            : "btw.error.modelUnavailable";
        setLastError(why);
        setErrorMessage(why);
        setPhase("error");
        return;
      }
      if (phase === "loading" || phase === "streaming") {
        // Concurrent send blocked per handoff §2 #13.
        return;
      }

      const userMessage: AgentMessage = {
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      // Build the pre-prompt messages:
      //   - First send (no persisted record yet): use the main session's
      //     full context + this user message.
      //   - Continuation: use the persisted BTW history + this user.
      const isInitialContext = !persisted;
      const baseMessages: AgentMessage[] = isInitialContext
        ? (getMainSessionMessages?.() ?? [])
        : (persisted?.messages ?? []);

      // §3.3 "user 消息在 send 调用前同步写入" — persist the user message
      // BEFORE firing fetch so a page reload mid-stream still shows the
      // question. The assistant will be written later, on agent_end.
      const now = Date.now();
      const nextPersisted: BtwPersisted = persisted
        ? {
            ...persisted,
            messages: [...persisted.messages, userMessage],
            lastUpdated: now,
          }
        : {
            version: 1,
            mainSessionId,
            modelSnapshot: { provider: model.provider, modelId: model.modelId },
            createdAt: now,
            lastUpdated: now,
            messages: [userMessage],
          };
      persist(nextPersisted);

      // Reset streaming state and arm the abort controller.
      setErrorMessage(undefined);
      setLastError(null);
      setStreamingMessage(INITIAL_ASSISTANT());
      setInFlightToolResults(new Map());
      setPhase("loading");

      const controller = new AbortController();
      const assistant = INITIAL_ASSISTANT();
      assistant.provider = model.provider;
      assistant.model = model.modelId;
      const state: InternalSendState = {
        controller,
        assistant,
        toolResults: new Map(),
      };
      inFlight.current = state;

      try {
        const res = await fetch("/api/btw/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mainSessionId,
            cwd,
            model,
            systemPrompt,
            toolNames,
            thinkingLevel,
            messages: baseMessages,
            userMessage,
            isInitialContext,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          // Server rejected the request before opening the SSE stream.
          // Surface the JSON body verbatim if present, else the HTTP
          // status. Mark as "error" so the user can retry; the user
          // message is already persisted.
          let detail = `HTTP ${res.status}`;
          try {
            const json = (await res.json()) as { error?: unknown };
            if (typeof json.error === "string") detail = json.error;
          } catch {
            /* ignore — keep status code */
          }
          setLastError(detail);
          setErrorMessage(detail);
          setPhase("error");
          setStreamingMessage(null);
          return;
        }

        setPhase("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawAgentEnd = false;

        // Minimal SSE parser: events are `data: <json>\n\n`, heartbeats
        // are `:\n\n` (or comments starting with `:`), everything else
        // is ignored. Splitting on `\n\n` and trimming handles both
        // well-formed and trailing-partial events.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sepIndex = buffer.indexOf("\n\n");
          while (sepIndex !== -1) {
            const chunk = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            for (const line of chunk.split("\n")) {
              if (!line || line.startsWith(":")) continue;
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              let parsedEvent: BtwSseEvent | null = null;
              try {
                parsedEvent = JSON.parse(payload) as BtwSseEvent;
              } catch {
                continue;
              }
              handleSseEvent(parsedEvent);
            }
            sepIndex = buffer.indexOf("\n\n");
          }
        }

        // Stream ended. If the server sent `agent_end`, the handler
        // above already finalised; if not, treat the truncation as a
        // network / cancellation failure.
        if (!sawAgentEnd) {
          setLastError("btw.error.network");
          setErrorMessage("btw.error.network");
          setPhase("error");
        }
        setStreamingMessage(null);
        inFlight.current = null;

        function handleSseEvent(event: BtwSseEvent) {
          switch (event.type) {
            case "connected":
              // First event the server emits after a successful boot.
              return;
            case "agent_start":
              // Reset the streaming placeholder. Mirrors main chat's
              // behaviour on agent_start.
              state.assistant = INITIAL_ASSISTANT();
              state.assistant.provider = model!.provider;
              state.assistant.model = model!.modelId;
              state.toolResults = new Map();
              setStreamingMessage({ ...state.assistant });
              setInFlightToolResults(new Map());
              return;
            case "message_start":
              return;
            case "message_update": {
              const inner = event.assistantMessageEvent as { type?: string; contentIndex?: number; delta?: string } | undefined;
              state.assistant = appendAssistantDelta(state.assistant, inner);
              setStreamingMessage({ ...state.assistant });
              return;
            }
            case "message_end": {
              const final = event.message as AgentMessage | undefined;
              if (final && final.role === "assistant") {
                const normalised = normalizeToolCalls(final);
                state.assistant = normalised as AssistantMessage;
                setStreamingMessage({ ...state.assistant });
              }
              return;
            }
            case "tool_execution_start": {
              const id = event.toolCallId as string;
              const name = event.toolName as string;
              state.assistant = pushToolCall(state.assistant, id, name, event.args);
              state.toolResults = applyPartialToolResult(state.toolResults, id, name, { content: [] });
              setStreamingMessage({ ...state.assistant });
              setInFlightToolResults(new Map(state.toolResults));
              return;
            }
            case "tool_execution_update": {
              const id = event.toolCallId as string;
              const name = event.toolName as string | undefined;
              const partial = event.partialResult as { content?: Array<{ type?: string; text?: string }> } | undefined;
              state.toolResults = applyPartialToolResult(state.toolResults, id, name, partial);
              setInFlightToolResults(new Map(state.toolResults));
              return;
            }
            case "tool_execution_end": {
              const id = event.toolCallId as string;
              const name = event.toolName as string | undefined;
              const result = event.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
              state.toolResults = applyPartialToolResult(state.toolResults, id, name, result);
              setInFlightToolResults(new Map(state.toolResults));
              return;
            }
            case "agent_end":
            case "agent_settled": {
              sawAgentEnd = true;
              // Persist the assistant immediately (§3.3 "assistant 仅在
              // 流式完整结束时写入一次"). The localStorage record now
              // has user + assistant for this turn. We deliberately
              // overwrite any earlier partial assistant that might be
              // on disk from a previous failed attempt — that one was
              // discarded per §3.3 "中途失败 / 取消：丢弃未完成的
              // assistant，不回滚已写入的 user".
              const finalAssistant: AssistantMessage = {
                ...state.assistant,
                timestamp: state.assistant.timestamp ?? Date.now(),
              };
              const current = readBtw(mainSessionId!);
              if (current) {
                const withoutLastUser = [...current.messages];
                // Drop the trailing user message that §3.3's "send
                // before fetch" pass already wrote; we re-append user
                // + assistant as a clean pair.
                if (
                  withoutLastUser.length > 0 &&
                  withoutLastUser[withoutLastUser.length - 1].role === "user"
                ) {
                  withoutLastUser.pop();
                }
                const updated: BtwPersisted = {
                  ...current,
                  messages: [...withoutLastUser, userMessage, finalAssistant],
                  lastUpdated: Date.now(),
                };
                persist(updated);
              }
              // Mirror any tool results into the persisted assistant.
              // We embed them in `toolResults` only in memory; they
              // aren't written to localStorage because the live
              // `inFlightToolResults` map covers UI rendering.
              setStreamingMessage(null);
              setInFlightToolResults(new Map());
              setPhase("idle");
              return;
            }
            case "prompt_failed":
            case "error": {
              const msg = (event.error as string | undefined) ?? (event.message as string | undefined) ?? "btw.error.network";
              setLastError(msg);
              setErrorMessage(msg);
              setPhase("error");
              setStreamingMessage(null);
              inFlight.current = null;
              // Signal to the outer while-loop that the stream is
              // terminal; the next reader.read() will return `done: true`
              // and we'll skip the "no agent_end" warning path.
              sawAgentEnd = true;
              return;
            }
            default:
              return;
          }
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          // User clicked "Stop". §3.3 "中途失败 / 取消：丢弃未完成的
          // assistant，不回滚已写入的 user". Streaming message and
          // assistant accumulator both dropped; phase returns to idle.
          setStreamingMessage(null);
          setInFlightToolResults(new Map());
          setPhase("idle");
          inFlight.current = null;
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message || "btw.error.network");
        setErrorMessage(message || "btw.error.network");
        setPhase("error");
        setStreamingMessage(null);
        inFlight.current = null;
      }
    },
    [cwd, getMainSessionMessages, mainSessionId, model, systemPrompt, toolNames, thinkingLevel, persist, persisted, phase],
  );

  // ── stop ────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    const cur = inFlight.current;
    if (!cur) return;
    cur.controller.abort();
    // State cleanup happens in send()'s AbortError branch.
  }, []);

  // ── clear ───────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    removePersisted();
  }, [removePersisted]);

  // ── refresh ─────────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    if (!mainSessionId) return;
    setPersisted(readBtw(mainSessionId));
  }, [mainSessionId]);

  return {
    enabled,
    messages: persisted?.messages ?? [],
    phase,
    errorMessage,
    lastError,
    streamingMessage,
    inFlightToolResults,
    send,
    stop,
    clear,
    refresh,
  };
}

// Re-export the shared AssistantContentBlock type so the BtwPanel can
// import it from a single place without reaching into the SDK types.
export type { AssistantContentBlock };