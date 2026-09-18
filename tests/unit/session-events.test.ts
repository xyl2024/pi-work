import { describe, expect, it } from "vitest";
import {
  IGNORED_SESSION_EVENTS,
  PORTED_SESSION_EVENT_TYPES,
  REDUCED_SESSION_EVENTS,
  SESSION_EVENT_TYPES,
  isPortedSessionEvent,
  reduceSessionEvent,
} from "@/lib/shared/session-events";
import type {
  PortedSessionEvent,
  SessionEvent,
  SessionEventEffect,
} from "@/lib/shared/session-events";
import {
  createSessionRuntimeState,
  patchSessionRuntimeState,
  type SessionRuntimeState,
} from "@/lib/shared/session-runtime-state";

// Pure unit tests for the session-event protocol (#58). The module is types +
// constants only, so this file checks the one runtime property the compile
// time checks cannot: that the two disposition lists and the enumerable type
// list agree with each other. If any of them drifts, the client would claim to
// have an opinion about an event it does not know, or silently ignore one it
// never decided about.

const reducedTypes = Object.keys(REDUCED_SESSION_EVENTS);
const ignoredTypes = Object.keys(IGNORED_SESSION_EVENTS);
const allTypes: readonly string[] = SESSION_EVENT_TYPES;

describe("session event protocol", () => {
  it("lists every protocol type exactly once", () => {
    expect(new Set(allTypes).size).toBe(allTypes.length);
    expect(allTypes.length).toBeGreaterThan(0);
  });

  it("partitions the protocol into reduced and deliberately-ignored", () => {
    expect(new Set([...reducedTypes, ...ignoredTypes])).toEqual(new Set(allTypes));
  });

  it("keeps the two lists disjoint", () => {
    const overlap = reducedTypes.filter((type) => ignoredTypes.includes(type));
    expect(overlap).toEqual([]);
  });

  it("does not put an extra member in the deliberately-ignored list", () => {
    expect(ignoredTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("does not put a reduced branch outside the protocol", () => {
    expect(reducedTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("gives every deliberately-ignored event a written reason", () => {
    expect(ignoredTypes.length).toBeGreaterThan(0);
    for (const type of ignoredTypes) {
      expect(IGNORED_SESSION_EVENTS[type as keyof typeof IGNORED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });

  it("gives every reduced branch a note", () => {
    expect(reducedTypes.length).toBeGreaterThan(0);
    for (const type of reducedTypes) {
      expect(REDUCED_SESSION_EVENTS[type as keyof typeof REDUCED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });
});

// ── The reducer (#60) ────────────────────────────────────────────────────
//
// The first slice of the port sends two real paths through the pure reducer:
// the dangerous-command confirmation and the ask-user-questions card. These
// tests assert the contract the adapter relies on — state transition plus the
// effects to perform — with no React, DOM or store involved.

const permissionEvent = {
  type: "permission_request",
  toolCallId: "call-1",
  ruleName: "rm",
  command: "rm -rf /tmp/x",
} satisfies PortedSessionEvent;

function askEvent(toolCallId: string, ts = 1_700_000_000_000): Extract<PortedSessionEvent, { type: "ask_user_questions_request" }> {
  return {
    type: "ask_user_questions_request",
    toolCallId,
    ts,
    questions: [{
      question: "Which one?",
      header: "Pick",
      multiSelect: false,
      required: true,
      options: [
        { label: "A", description: "first" },
        { label: "B", description: "second" },
      ],
    }],
  };
}

/** A batch whose only question has no options — the old handler dropped it. */
const malformedAskEvent = {
  type: "ask_user_questions_request",
  toolCallId: "ask-bad",
  ts: 1,
  questions: [{ question: "no options", header: "Bad" }],
} as unknown as PortedSessionEvent;

describe("session event reducer", () => {
  it("reduces a permission request into an effect and leaves state untouched", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, permissionEvent);

    expect(reduction.state).toBe(state);
    expect(reduction.effects).toEqual([{
      kind: "enqueue_permission_request",
      toolCallId: "call-1",
      ruleName: "rm",
      command: "rm -rf /tmp/x",
    }]);
  });

  it("records an ask-user-questions request and returns its effects", () => {
    const state = createSessionRuntimeState();
    const event = askEvent("ask-1");

    const reduction = reduceSessionEvent(state, event);

    expect(reduction.state.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(true);
    expect(reduction.effects).toEqual([
      { kind: "set_pending_ask_user_questions", request: { toolCallId: "ask-1", questions: event.questions, ts: 1_700_000_000_000 } },
      { kind: "play_ui_sound", sound: "ask_user_questions" },
    ]);
  });

  it("does not ring twice when the server replays the same pending request", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), askEvent("ask-1"));

    // SSE reconnect re-emits every pending request; a replay must claim the
    // same id again and therefore ask for nothing. This is the test that pins
    // "reconnect is silent".
    const replay = reduceSessionEvent(first.state, askEvent("ask-1"));

    expect(replay.state).toBe(first.state);
    expect(replay.effects).toEqual([]);
  });

  it("rings again for a genuinely new question", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), askEvent("ask-1"));

    const second = reduceSessionEvent(first.state, askEvent("ask-2"));

    expect(second.state.seenAskUserQuestionsToolCallIds.has("ask-2")).toBe(true);
    expect(second.effects.map((effect) => effect.kind))
      .toEqual(["set_pending_ask_user_questions", "play_ui_sound"]);
  });

  it("isolates the ask-user-questions ledger per session", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();
    reduceSessionEvent(a, askEvent("ask-1"));

    // The id already announced in session A must not suppress a first-time
    // question in session B — the ledger lives in the state, not at module
    // scope.
    expect(a.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(true);
    expect(b.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(false);
    const inB = reduceSessionEvent(b, askEvent("ask-1"));
    expect(inB.effects.map((effect) => effect.kind))
      .toEqual(["set_pending_ask_user_questions", "play_ui_sound"]);
  });

  it("drops a malformed question batch without changing state or ringing", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, malformedAskEvent);

    expect(reduction.state).toBe(state);
    expect(reduction.effects).toEqual([]);
  });

  it("leaves unrelated runtime state alone", () => {
    const state = patchSessionRuntimeState(createSessionRuntimeState(), "agentRunning", true);

    const reduction = reduceSessionEvent(state, permissionEvent);

    expect(reduction.state.agentRunning).toBe(true);
    expect(reduction.state.messages).toEqual([]);
  });

  it("routes only the ported events to the reducer", () => {
    for (const type of PORTED_SESSION_EVENT_TYPES) {
      expect(isPortedSessionEvent({ type } as SessionEvent)).toBe(true);
    }
    expect(isPortedSessionEvent({ type: "agent_start" })).toBe(false);
    expect(isPortedSessionEvent({ type: "connected", sessionId: "s" })).toBe(false);
  });
});

// ── The tool-execution group (#61) ───────────────────────────────────────
//
// Start / partial result / end, and every side effect they used to fire
// inline. The load-bearing test here is the git one: the end event carries no
// arguments, so "did this bash touch git?" can only be answered from the
// arguments recorded when the call started. That rule had no test before the
// port and is the easiest thing to break silently while moving code.

type StartEvent = Extract<PortedSessionEvent, { type: "tool_execution_start" }>;
type UpdateEvent = Extract<PortedSessionEvent, { type: "tool_execution_update" }>;
type EndEvent = Extract<PortedSessionEvent, { type: "tool_execution_end" }>;

function toolStart(toolCallId: string, toolName: string, args: unknown = {}): StartEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}

function toolUpdate(toolCallId: string, toolName: string, partialResult: unknown): UpdateEvent {
  return { type: "tool_execution_update", toolCallId, toolName, args: {}, partialResult };
}

function toolEnd(toolCallId: string, toolName: string, result: unknown = undefined, isError = false): EndEvent {
  return { type: "tool_execution_end", toolCallId, toolName, result, isError };
}

/** Fold a whole event sequence, collecting every requested effect in order. */
function reduceAll(state: SessionRuntimeState, events: PortedSessionEvent[]) {
  let current = state;
  const effects: SessionEventEffect[] = [];
  for (const event of events) {
    const reduction = reduceSessionEvent(current, event);
    current = reduction.state;
    effects.push(...reduction.effects);
  }
  return { state: current, effects };
}

function kindsOf(effects: SessionEventEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

describe("session event reducer: tool execution", () => {
  it("remembers the tool call's name and args while it is in flight", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, toolStart("call-1", "bash", { command: "ls -la" }));

    expect(reduction.state.inFlightTools.get("call-1")?.name).toBe("bash");
    expect(reduction.state.inFlightTools.get("call-1")?.args).toEqual({ command: "ls -la" });
    expect(reduction.state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "call-1", name: "bash", args: { command: "ls -la" } }],
    });
    expect(reduction.effects).toEqual([{
      kind: "report_tool_call_stats",
      report: { type: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls -la" } },
    }]);
  });

  it("reports no args for a non-object argument bag", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, toolStart("call-1", "bash", [1, 2, 3]));

    expect(reduction.state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "call-1", name: "bash", args: undefined }],
    });
  });

  it("keeps the accumulated partial output when a start is replayed", () => {
    const start = toolStart("call-1", "bash", { command: "ls" });
    const once = reduceSessionEvent(createSessionRuntimeState(), start);
    const streaming = reduceSessionEvent(
      once.state,
      toolUpdate("call-1", "bash", { content: [{ type: "text", text: "partial" }] }),
    );

    // SSE reconnect replays the start; the output that already streamed in
    // must survive it, and the phase chip must not gain a duplicate entry.
    const replayed = reduceSessionEvent(streaming.state, start);

    expect(replayed.state.inFlightTools.get("call-1")?.result?.content)
      .toEqual([{ type: "text", text: "partial" }]);
    expect(replayed.state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "call-1", name: "bash", args: { command: "ls" } }],
    });
  });

  it("keeps the phase chip in step as several tools run and finish", () => {
    const events: PortedSessionEvent[] = [
      toolStart("a", "bash", {}),
      toolStart("b", "edit", {}),
      toolEnd("a", "bash"),
    ];

    const running = reduceAll(createSessionRuntimeState(), events);

    expect(running.state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "b", name: "edit", args: {} }],
    });

    const idle = reduceSessionEvent(running.state, toolEnd("b", "edit"));
    expect(idle.state.agentPhase).toEqual({ kind: "waiting_model" });
    expect(idle.state.inFlightTools.size).toBe(0);
  });

  it("merges the partial results of one call instead of stacking them", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "bash", {}));
    const second = reduceSessionEvent(
      first.state,
      toolUpdate("call-1", "bash", { content: [{ type: "text", text: "part 1" }] }),
    );
    const third = reduceSessionEvent(
      second.state,
      toolUpdate("call-1", "bash", {
        content: [{ type: "text", text: "part 1 part 2" }],
        details: { taskId: "task-1" },
      }),
    );

    const result = third.state.inFlightTools.get("call-1")?.result;
    expect(result?.content).toEqual([{ type: "text", text: "part 1 part 2" }]);
    expect(result?.details).toEqual({ taskId: "task-1" });
    expect(kindsOf(third.effects)).toEqual([]);
  });

  it("keeps details that arrived before the latest content snapshot", () => {
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "spawn_subagent", {}));
    const withDetails = reduceSessionEvent(
      started.state,
      toolUpdate("call-1", "spawn_subagent", { details: { taskId: "task-1" } }),
    );
    const withText = reduceSessionEvent(
      withDetails.state,
      toolUpdate("call-1", "spawn_subagent", { content: [{ type: "text", text: "running" }] }),
    );

    const result = withText.state.inFlightTools.get("call-1")?.result;
    expect(result?.content).toEqual([{ type: "text", text: "running" }]);
    expect(result?.details).toEqual({ taskId: "task-1" });
  });

  it("ignores an empty partial result and an update for an unknown call", () => {
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "bash", {}));

    const empty = reduceSessionEvent(started.state, toolUpdate("call-1", "bash", {}));
    expect(empty.state).toBe(started.state);
    expect(empty.effects).toEqual([]);

    const unknown = reduceSessionEvent(started.state, toolUpdate("call-9", "bash", {
      content: [{ type: "text", text: "stray" }],
    }));
    expect(unknown.state).toBe(started.state);
    expect(unknown.effects).toEqual([]);
  });

  it("decides git invalidation from the args recorded at start, not from the end event", () => {
    // `tool_execution_end` carries no args at all — this is the whole point.
    const committed = reduceAll(createSessionRuntimeState(), [
      toolStart("call-1", "bash", { command: "git commit -m wip" }),
      toolEnd("call-1", "bash", { content: [{ type: "text", text: "done" }] }),
    ]);

    expect(committed.effects).toContainEqual({ kind: "invalidate_git_status", force: true });
  });

  it("leaves git alone for a bash call that never mentioned git", () => {
    const plain = reduceAll(createSessionRuntimeState(), [
      toolStart("call-1", "bash", { command: "ls -la" }),
      toolEnd("call-1", "bash"),
    ]);

    expect(kindsOf(plain.effects)).not.toContain("invalidate_git_status");
  });

  it("invalidates git without forcing for edit / write", () => {
    const edited = reduceAll(createSessionRuntimeState(), [
      toolStart("call-1", "edit", { path: "a.ts" }),
      toolEnd("call-1", "edit"),
    ]);

    expect(edited.effects).toContainEqual({ kind: "invalidate_git_status", force: false });
  });

  it("celebrates once per celebrate call, even when the end event is replayed", () => {
    const details = { style: "grand", resolvedStyle: "grand", durationMs: 4000 } as const;
    const first = reduceAll(createSessionRuntimeState(), [
      toolStart("call-1", "celebrate", {}),
      toolEnd("call-1", "celebrate", { details }, false),
    ]);

    expect(first.effects).toContainEqual({ kind: "celebrate", details });

    // SSE reconnect replays the same end event: the ledger already holds the
    // id, so the overlay must not fire a second time.
    const replay = reduceSessionEvent(first.state, toolEnd("call-1", "celebrate", { details }, false));
    expect(kindsOf(replay.effects)).not.toContain("celebrate");
  });

  it("isolates the celebrate ledger per session", () => {
    const end = toolEnd("call-1", "celebrate", undefined, false);
    const inA = reduceSessionEvent(createSessionRuntimeState(), end);
    const inB = reduceSessionEvent(createSessionRuntimeState(), end);

    expect(kindsOf(inA.effects)).toContain("celebrate");
    expect(kindsOf(inB.effects)).toContain("celebrate");
  });

  it("refreshes the subagent panel once per spawn_subagent call", () => {
    const startOnce = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "spawn_subagent", {}));
    expect(kindsOf(startOnce.effects)).toContain("refresh_subagent_panel");

    const startAgain = reduceSessionEvent(startOnce.state, toolStart("call-1", "spawn_subagent", {}));
    expect(kindsOf(startAgain.effects)).not.toContain("refresh_subagent_panel");

    const endOnce = reduceSessionEvent(startAgain.state, toolEnd("call-1", "spawn_subagent"));
    expect(kindsOf(endOnce.effects)).toContain("refresh_subagent_panel");

    const endAgain = reduceSessionEvent(endOnce.state, toolEnd("call-1", "spawn_subagent"));
    expect(kindsOf(endAgain.effects)).not.toContain("refresh_subagent_panel");
  });

  it("publishes a show_media result for the session library", () => {
    const files = [{ path: "/tmp/a.png", exists: true, category: "image" }];
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "show_media", {}));

    const reduction = reduceSessionEvent(
      started.state,
      toolEnd("call-1", "show_media", { details: { files, summary: "1 file" } }),
    );

    expect(reduction.effects).toContainEqual({ kind: "show_file_result", toolCallId: "call-1", files });
  });

  it("publishes a result from the legacy show_file name too", () => {
    const files = [{ path: "/tmp/old.png", exists: true }];
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "show_file", {}));

    const reduction = reduceSessionEvent(
      started.state,
      toolEnd("call-1", "show_file", { details: { files } }),
    );

    expect(kindsOf(reduction.effects)).toContain("show_file_result");
  });

  it("flashes the bot only for a failed tool call", () => {
    const failed = reduceSessionEvent(createSessionRuntimeState(), toolEnd("call-1", "bash", undefined, true));
    expect(failed.effects).toContainEqual({ kind: "flash_bot_state", stateKey: "suspicious" });

    const ok = reduceSessionEvent(createSessionRuntimeState(), toolEnd("call-2", "bash", undefined, false));
    expect(kindsOf(ok.effects)).not.toContain("flash_bot_state");
  });

  it("reports the end with the first text block, truncated for the stats store", () => {
    const long = "x".repeat(2000);
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "bash", { command: "ls" }));

    const reduction = reduceSessionEvent(
      started.state,
      toolEnd("call-1", "bash", { content: [{ type: "text", text: long }], details: { exitCode: 1 } }, true),
    );

    const report = reduction.effects.find((effect) => effect.kind === "report_tool_call_stats");
    expect(report).toEqual({
      kind: "report_tool_call_stats",
      report: {
        type: "tool_end",
        toolCallId: "call-1",
        isError: true,
        resultText: `${"x".repeat(1024)}…`,
        resultDetails: { exitCode: 1 },
      },
    });
  });

  it("retires the in-flight tool once it ends", () => {
    const started = reduceSessionEvent(createSessionRuntimeState(), toolStart("call-1", "bash", {}));

    const ended = reduceSessionEvent(started.state, toolEnd("call-1", "bash"));

    expect(ended.state.inFlightTools.size).toBe(0);
    expect(ended.state.agentPhase).toEqual({ kind: "waiting_model" });
  });

  it("routes the three tool events to the reducer", () => {
    expect(isPortedSessionEvent(toolStart("call-1", "bash"))).toBe(true);
    expect(isPortedSessionEvent(toolUpdate("call-1", "bash", {}))).toBe(true);
    expect(isPortedSessionEvent(toolEnd("call-1", "bash"))).toBe(true);
  });
});

// ── The message / conversation-tree group (#62) ──────────────────────────
//
// What the user stares at the longest: the streaming bubble, the message once
// it settles, the conversation tree and its active leaf, and the context-usage
// ring after each assistant message. Two rules here are easy to break silently
// and therefore have their own tests: a replayed `message_end` (SSE reconnect
// or a compaction replay) must not enqueue the same assistant message twice,
// and the brand-new-session "first assistant landed" callback must fire exactly
// once. The context refresh is an *effect* — the reducer asks for it, the
// adapter performs it.

type MessageStartEvent = Extract<PortedSessionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<PortedSessionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<PortedSessionEvent, { type: "message_end" }>;
type TreeUpdateEvent = Extract<PortedSessionEvent, { type: "session_tree_update" }>;

/** A pi-shaped assistant message (raw blocks, before normalization). */
function assistantMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    model: "m",
    provider: "p",
    timestamp: 1,
    ...overrides,
  };
}

function messageStart(message: unknown): MessageStartEvent {
  return { type: "message_start", message: message as MessageStartEvent["message"] };
}

function messageUpdate(message: unknown): MessageUpdateEvent {
  return { type: "message_update", message: message as MessageUpdateEvent["message"] };
}

function messageEnd(message: unknown): MessageEndEvent {
  return { type: "message_end", message: message as MessageEndEvent["message"] };
}

function treeUpdate(tree: unknown, leafId: string | null): TreeUpdateEvent {
  return { type: "session_tree_update", tree, leafId };
}

describe("session event reducer: messages and the conversation tree", () => {
  it("mirrors the pushed tree and its active leaf", () => {
    const tree = [{ type: "message", id: "e1", parentId: null, timestamp: "t" }];

    const reduction = reduceSessionEvent(createSessionRuntimeState(), treeUpdate(tree, "e1"));

    expect(reduction.state.liveTree).toBe(tree);
    expect(reduction.state.activeLeafId).toBe("e1");
    expect(reduction.effects).toEqual([]);
  });

  it("leaves the leaf alone when the update carries a null leaf", () => {
    const anchored = patchSessionRuntimeState(createSessionRuntimeState(), "activeLeafId", "e1");

    // A null leaf is deliberately not applied: the tree panel falls back to
    // the leaf loaded from disk, exactly as the previous handler did.
    const reduction = reduceSessionEvent(anchored, treeUpdate(undefined, null));

    expect(reduction.state).toBe(anchored);
    expect(reduction.state.activeLeafId).toBe("e1");
  });

  it("changes nothing when the same tree is pushed again", () => {
    const tree = [{ type: "message", id: "e1", parentId: null, timestamp: "t" }];
    const first = reduceSessionEvent(createSessionRuntimeState(), treeUpdate(tree, "e1"));

    const replay = reduceSessionEvent(first.state, treeUpdate(tree, "e1"));

    expect(replay.state).toBe(first.state);
    expect(replay.effects).toEqual([]);
  });

  it("streams a non-user message into the live view without committing it", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, messageUpdate(assistantMessage()));

    // The streamed snapshot goes to the streaming store (its own module), not
    // into the committed message list.
    expect(reduction.effects).toEqual([{ kind: "stream_message", message: assistantMessage() }]);
    expect(reduction.state.messages).toEqual([]);
    expect(reduction.state.agentPhase).toBeNull();
  });

  it("normalizes a streamed tool call into the render shape", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState(),
      messageUpdate(assistantMessage({ content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] })),
    );

    expect(reduction.effects).toEqual([{
      kind: "stream_message",
      message: assistantMessage({
        content: [{ type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "ls" } }],
      }),
    }]);
  });

  it("does not stream a user message", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState(),
      messageStart({ role: "user", content: "hi" }),
    );

    expect(reduction.effects).toEqual([]);
  });

  it("refreshes the subagent panel once while a spawn_subagent message streams", () => {
    const raw = assistantMessage({
      content: [{ type: "toolCall", toolCallId: "c1", toolName: "spawn_subagent", input: {} }],
    });

    const start = reduceSessionEvent(createSessionRuntimeState(), messageStart(raw));
    expect(kindsOf(start.effects)).toContain("refresh_subagent_panel");

    // Every subsequent token re-announces the same tool call; the ledger must
    // absorb it.
    const update = reduceSessionEvent(start.state, messageUpdate(raw));
    expect(kindsOf(update.effects)).not.toContain("refresh_subagent_panel");
  });

  it("commits a settled assistant message and asks for the context refresh", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, messageEnd(assistantMessage()));

    expect(reduction.state.messages).toEqual([assistantMessage()]);
    expect(reduction.state.agentPhase).toEqual({ kind: "waiting_model" });
    expect(reduction.effects).toEqual([
      { kind: "settle_stream", message: assistantMessage(), keepForError: false },
      { kind: "record_assistant_outcome", isBody: true, pendingError: null },
      { kind: "refresh_context_usage" },
    ]);
  });

  it("does not enqueue the same assistant message twice when message_end is replayed", () => {
    // SSE reconnect and compaction both replay the end of a message; the
    // replayed payload is equal but not identical.
    const message = assistantMessage();
    const first = reduceSessionEvent(createSessionRuntimeState(), messageEnd(message));

    const replay = reduceSessionEvent(
      first.state,
      messageEnd(JSON.parse(JSON.stringify(message)) as Record<string, unknown>),
    );

    expect(replay.state.messages).toHaveLength(1);
    expect(replay.state.messages).toEqual([assistantMessage()]);
  });

  it("keeps two genuinely different settled messages apart", () => {
    // The dedupe is identity, not a one-slot guard: a multi-step turn's
    // successive assistant messages (different timestamps) and a turn's
    // several tool results (different tool-call ids) all have to land.
    const first = reduceSessionEvent(createSessionRuntimeState(), messageEnd(assistantMessage()));
    const second = reduceSessionEvent(first.state, messageEnd(assistantMessage({ timestamp: 2 })));
    expect(second.state.messages).toHaveLength(2);

    const toolA = reduceSessionEvent(createSessionRuntimeState(), messageEnd({ role: "toolResult", toolCallId: "a", content: [] }));
    const toolB = reduceSessionEvent(toolA.state, messageEnd({ role: "toolResult", toolCallId: "b", content: [] }));
    expect(toolB.state.messages).toHaveLength(2);
  });

  it("settles a user message without committing it or refreshing context", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState(),
      messageEnd({ role: "user", content: "hi" }),
    );

    expect(reduction.state.messages).toEqual([]);
    expect(reduction.effects).toEqual([{ kind: "settle_stream", message: null, keepForError: false }]);
  });

  it("fires the first-assistant callback exactly once", () => {
    const awaiting = patchSessionRuntimeState(createSessionRuntimeState(), "awaitingFirstAssistant", true);

    const first = reduceSessionEvent(awaiting, messageEnd(assistantMessage()));
    expect(kindsOf(first.effects)).toContain("first_assistant_ready");
    expect(first.state.awaitingFirstAssistant).toBe(false);

    // A second assistant message (or a replay of the first) sees the flag
    // cleared and stays silent.
    const second = reduceSessionEvent(first.state, messageEnd(assistantMessage({ timestamp: 2 })));
    expect(kindsOf(second.effects)).not.toContain("first_assistant_ready");
  });

  it("does not fire the first-assistant callback for a user message", () => {
    const awaiting = patchSessionRuntimeState(createSessionRuntimeState(), "awaitingFirstAssistant", true);

    const reduction = reduceSessionEvent(awaiting, messageEnd({ role: "user", content: "hi" }));

    expect(kindsOf(reduction.effects)).not.toContain("first_assistant_ready");
    expect(reduction.state.awaitingFirstAssistant).toBe(true);
  });

  it("keeps a failed assistant snapshot and records the error for the end of the turn", () => {
    const failed = assistantMessage({ stopReason: "error", errorMessage: "boom" });

    const reduction = reduceSessionEvent(createSessionRuntimeState(), messageEnd(failed));

    expect(reduction.effects).toContainEqual({
      kind: "settle_stream",
      message: reduction.state.messages[0],
      keepForError: true,
    });
    expect(reduction.effects).toContainEqual({
      kind: "record_assistant_outcome",
      isBody: false,
      pendingError: "boom",
    });
  });

  it("falls back to a generic error text when pi reports none", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState(),
      messageEnd(assistantMessage({ stopReason: "error" })),
    );

    expect(reduction.effects).toContainEqual({
      kind: "record_assistant_outcome",
      isBody: false,
      pendingError: "Model call failed",
    });
  });

  it("classifies a plain body answer as a body message", () => {
    const reduction = reduceSessionEvent(createSessionRuntimeState(), messageEnd(assistantMessage()));

    expect(reduction.effects).toContainEqual({
      kind: "record_assistant_outcome",
      isBody: true,
      pendingError: null,
    });
  });

  it("does not classify a tool-only answer as a body message", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState(),
      messageEnd(assistantMessage({
        content: [{ type: "toolCall", toolCallId: "c1", toolName: "bash", input: {} }],
      })),
    );

    expect(reduction.effects).toContainEqual({
      kind: "record_assistant_outcome",
      isBody: false,
      pendingError: null,
    });
  });

  it("asks for the context refresh instead of performing it", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, messageEnd(assistantMessage()));

    // The request is the adapter's job; the reducer only decides it is time.
    expect(kindsOf(reduction.effects)).toContain("refresh_context_usage");
    expect(reduction.state.contextUsage).toBe(state.contextUsage);
    expect(reduction.state.contextComposition).toBe(state.contextComposition);
  });

  it("routes the message and conversation-tree events to the reducer", () => {
    expect(isPortedSessionEvent(messageStart(assistantMessage()))).toBe(true);
    expect(isPortedSessionEvent(messageUpdate(assistantMessage()))).toBe(true);
    expect(isPortedSessionEvent(messageEnd(assistantMessage()))).toBe(true);
    expect(isPortedSessionEvent(treeUpdate([], null))).toBe(true);
  });
});
