import { describe, expect, it } from "vitest";
import {
  IGNORED_SESSION_EVENTS,
  REDUCED_SESSION_EVENTS,
  SESSION_EVENT_TYPES,
  isReducedSessionEvent,
  reduceSessionEvent,
} from "@/lib/shared/session-events";
import type {
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
} satisfies SessionEvent;

function askEvent(toolCallId: string, ts = 1_700_000_000_000): Extract<SessionEvent, { type: "ask_user_questions_request" }> {
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
} as unknown as SessionEvent;

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

  it("recognises exactly the reduced events as reduced", () => {
    // The reducer's routing question: yes for every reduced type, no for every
    // deliberately-ignored one. That is also the partition the total
    // `reduceSessionEvent` relies on, so no ignored event can reach a branch.
    for (const type of reducedTypes) {
      expect(isReducedSessionEvent({ type } as SessionEvent)).toBe(true);
    }
    for (const type of ignoredTypes) {
      expect(isReducedSessionEvent({ type } as SessionEvent)).toBe(false);
    }
  });
});

// ── The tool-execution group (#61) ───────────────────────────────────────
//
// Start / partial result / end, and every side effect they used to fire
// inline. The load-bearing test here is the git one: the end event carries no
// arguments, so "did this bash touch git?" can only be answered from the
// arguments recorded when the call started. That rule had no test before the
// port and is the easiest thing to break silently while moving code.

type StartEvent = Extract<SessionEvent, { type: "tool_execution_start" }>;
type UpdateEvent = Extract<SessionEvent, { type: "tool_execution_update" }>;
type EndEvent = Extract<SessionEvent, { type: "tool_execution_end" }>;

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
function reduceAll(state: SessionRuntimeState, events: SessionEvent[]) {
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
    const events: SessionEvent[] = [
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

  it("counts the three tool events among the reduced events", () => {
    expect(isReducedSessionEvent(toolStart("call-1", "bash"))).toBe(true);
    expect(isReducedSessionEvent(toolUpdate("call-1", "bash", {}))).toBe(true);
    expect(isReducedSessionEvent(toolEnd("call-1", "bash"))).toBe(true);
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

type MessageStartEvent = Extract<SessionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<SessionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<SessionEvent, { type: "message_end" }>;
type TreeUpdateEvent = Extract<SessionEvent, { type: "session_tree_update" }>;

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

  it("counts the message and conversation-tree events among the reduced events", () => {
    expect(isReducedSessionEvent(messageStart(assistantMessage()))).toBe(true);
    expect(isReducedSessionEvent(messageUpdate(assistantMessage()))).toBe(true);
    expect(isReducedSessionEvent(messageEnd(assistantMessage()))).toBe(true);
    expect(isReducedSessionEvent(treeUpdate([], null))).toBe(true);
  });
});

// ── The turn / phase group (#63) ─────────────────────────────────────────
//
// The last group: when a turn starts and ends, when compaction starts and
// ends, auto-retry, a send failure, and the thinking level. These decide the
// "still running / compacting / waiting for the model / retrying" indicators
// the user waits on, plus the sound, Pi Bot reaction and error toast at the
// end of a turn. The port is behaviour-frozen: the chat still closes its turn
// on `agent_end` (ADR-0004 revisits that separately), and `agent_settled`
// stays deliberately ignored.

type AgentStartEvent = Extract<SessionEvent, { type: "agent_start" }>;
type AgentEndEvent = Extract<SessionEvent, { type: "agent_end" }>;
type PromptFailedEvent = Extract<SessionEvent, { type: "prompt_failed" }>;
type AutoRetryEndEvent = Extract<SessionEvent, { type: "auto_retry_end" }>;
type CompactionEndEvent = Extract<SessionEvent, { type: "compaction_end" }>;

const agentStart: AgentStartEvent = { type: "agent_start" };

function agentEnd(): AgentEndEvent {
  return { type: "agent_end", messages: [], willRetry: false };
}

function compactionEnd(overrides: Partial<CompactionEndEvent> = {}): CompactionEndEvent {
  return { type: "compaction_end", reason: "threshold", result: undefined, aborted: false, willRetry: false, ...overrides };
}

/** A session that was mid-turn with the turn's body-answer scratchpad set. */
function midTurn(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return createSessionRuntimeState({
    agentRunning: true,
    agentPhase: { kind: "waiting_model" },
    retryInfo: { attempt: 1, maxAttempts: 3, errorMessage: "rate limited" },
    ...overrides,
  });
}

describe("session event reducer: turn and phase", () => {
  it("opens a fresh turn on agent_start", () => {
    const state = createSessionRuntimeState({
      runtimeError: "previous failure",
      agentRunning: false,
      isCompacting: true,
      lastAssistantIsBody: true,
    });

    const reduction = reduceSessionEvent(state, agentStart);

    expect(reduction.state.runtimeError).toBeNull();
    expect(reduction.state.agentRunning).toBe(true);
    expect(reduction.state.isCompacting).toBe(false);
    expect(reduction.state.agentPhase).toEqual({ kind: "waiting_model" });
    expect(reduction.state.lastAssistantIsBody).toBe(false);
    expect(kindsOf(reduction.effects)).toEqual([
      "begin_stream",
      "reset_tool_call_stats",
      "refresh_system_prompt",
      "set_bot_baseline",
    ]);
  });

  it("does not clear a pending error when a new turn starts", () => {
    // The old handler only reset the body-answer scratchpad here; a pending
    // error survives until it is surfaced (or an auto-retry gives up).
    const state = createSessionRuntimeState({ pendingAssistantError: "boom" });

    const reduction = reduceSessionEvent(state, agentStart);

    expect(reduction.state.pendingAssistantError).toBe("boom");
  });

  it("closes a clean body turn with the success sound and a happy bot", () => {
    const reduction = reduceSessionEvent(midTurn({ lastAssistantIsBody: true }), agentEnd());

    expect(reduction.state.agentRunning).toBe(false);
    expect(reduction.state.isCompacting).toBe(false);
    expect(reduction.state.agentPhase).toBeNull();
    expect(reduction.state.retryInfo).toBeNull();
    expect(reduction.state.runtimeError).toBeNull();
    expect(reduction.effects).toEqual([
      { kind: "settle_stream", message: null, keepForError: false },
      { kind: "play_ui_sound", sound: "agent_success" },
      { kind: "flash_bot_state", stateKey: "happy" },
      { kind: "reload_session_after_turn" },
      { kind: "notify_agent_end" },
    ]);
  });

  it("surfaces a pending model error at the end of the turn", () => {
    const state = midTurn({ pendingAssistantError: "boom" });

    const reduction = reduceSessionEvent(state, agentEnd());

    expect(reduction.state.runtimeError).toBe("boom");
    expect(reduction.state.pendingAssistantError).toBeNull();
    expect(reduction.effects).toEqual([
      { kind: "settle_stream", message: null, keepForError: true },
      { kind: "show_error_toast", message: "boom" },
      { kind: "play_ui_sound", sound: "agent_failure" },
      { kind: "flash_bot_state", stateKey: "waking" },
      { kind: "reload_session_after_turn" },
      { kind: "notify_agent_end" },
    ]);
  });

  it("stays silent when a tool-only turn ends without an error", () => {
    const reduction = reduceSessionEvent(midTurn({ lastAssistantIsBody: false }), agentEnd());

    expect(kindsOf(reduction.effects)).not.toContain("play_ui_sound");
    expect(reduction.effects).toContainEqual({ kind: "flash_bot_state", stateKey: "waking" });
  });

  it("counts an empty pending error as a failed turn but shows no toast", () => {
    // The old handler treated "a pending error exists" and "the error has
    // text" separately: an empty message still kept the streaming snapshot and
    // rang the failure sound, but produced no runtime error and no toast.
    const state = midTurn({ pendingAssistantError: "", lastAssistantIsBody: true });

    const reduction = reduceSessionEvent(state, agentEnd());

    expect(reduction.state.runtimeError).toBeNull();
    expect(reduction.state.pendingAssistantError).toBe("");
    expect(reduction.effects).toContainEqual({ kind: "settle_stream", message: null, keepForError: true });
    expect(kindsOf(reduction.effects)).not.toContain("show_error_toast");
    expect(kindsOf(reduction.effects)).toContain("play_ui_sound");
  });

  it("shows the auto-retry counter while a retry is pending", () => {
    const reduction = reduceSessionEvent(createSessionRuntimeState(), {
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 1000,
      errorMessage: "rate limited",
    });

    expect(reduction.state.retryInfo).toEqual({ attempt: 2, maxAttempts: 5, errorMessage: "rate limited" });
    expect(reduction.effects).toEqual([]);
  });

  it("clears the retry counter once a retry succeeds", () => {
    const reduction = reduceSessionEvent(midTurn(), { type: "auto_retry_end", success: true, attempt: 2 });

    expect(reduction.state.retryInfo).toBeNull();
    expect(reduction.effects).toEqual([]);
  });

  it("surfaces the final error when the retries are exhausted", () => {
    const state = midTurn({ pendingAssistantError: "boom" });
    const event: AutoRetryEndEvent = { type: "auto_retry_end", success: false, attempt: 3, finalError: "gave up" };

    const reduction = reduceSessionEvent(state, event);

    expect(reduction.state.retryInfo).toBeNull();
    expect(reduction.state.runtimeError).toBe("gave up");
    expect(reduction.state.pendingAssistantError).toBeNull();
    expect(reduction.effects).toEqual([
      { kind: "show_error_toast", message: "gave up" },
      { kind: "play_ui_sound", sound: "agent_failure" },
    ]);
  });

  it("only clears the counter when a failed retry reported no final error", () => {
    const state = midTurn({ pendingAssistantError: "boom" });

    const reduction = reduceSessionEvent(state, { type: "auto_retry_end", success: false, attempt: 3 });

    expect(reduction.state.retryInfo).toBeNull();
    expect(reduction.state.runtimeError).toBeNull();
    expect(reduction.state.pendingAssistantError).toBe("boom");
    expect(reduction.effects).toEqual([]);
  });

  it("closes the turn and drops the stream on a send failure", () => {
    const event: PromptFailedEvent = { type: "prompt_failed", error: "no api key" };

    const reduction = reduceSessionEvent(midTurn(), event);

    expect(reduction.state.agentRunning).toBe(false);
    expect(reduction.state.isCompacting).toBe(false);
    expect(reduction.state.agentPhase).toBeNull();
    expect(reduction.state.retryInfo).toBeNull();
    expect(reduction.state.runtimeError).toBe("no api key");
    expect(reduction.effects).toEqual([
      { kind: "settle_stream", message: null, keepForError: false },
      { kind: "show_error_toast", message: "no api key" },
      { kind: "close_events" },
    ]);
  });

  it("marks the session as compacting while compaction runs", () => {
    const reduction = reduceSessionEvent(
      createSessionRuntimeState({ agentRunning: false }),
      { type: "compaction_start", reason: "threshold" },
    );

    expect(reduction.state.agentRunning).toBe(true);
    expect(reduction.state.isCompacting).toBe(true);
    expect(reduction.state.agentPhase).toEqual({ kind: "compacting" });
    expect(reduction.effects).toEqual([]);
  });

  it("keeps the session running when a compaction retries", () => {
    const state = midTurn({ isCompacting: true, agentPhase: { kind: "compacting" } });

    const reduction = reduceSessionEvent(state, compactionEnd({ willRetry: true }));

    expect(reduction.state.isCompacting).toBe(false);
    expect(reduction.state.agentRunning).toBe(true);
    expect(reduction.state.agentPhase).toEqual({ kind: "waiting_model" });
    expect(reduction.effects).toEqual([]);
  });

  it("closes the turn and resyncs from disk when compaction finishes", () => {
    const state = midTurn({ isCompacting: true, agentPhase: { kind: "compacting" } });

    const reduction = reduceSessionEvent(state, compactionEnd());

    expect(reduction.state.isCompacting).toBe(false);
    expect(reduction.state.agentRunning).toBe(false);
    expect(reduction.state.agentPhase).toBeNull();
    expect(reduction.effects).toEqual([
      { kind: "settle_stream", message: null, keepForError: false },
      { kind: "reload_session_after_compaction", aborted: false },
    ]);
  });

  it("does not re-read an aborted compaction", () => {
    const reduction = reduceSessionEvent(midTurn({ isCompacting: true }), compactionEnd({ aborted: true }));

    expect(reduction.effects).toContainEqual({ kind: "reload_session_after_compaction", aborted: true });
  });

  it("reports a compaction error without tearing the retry down", () => {
    const retrying = reduceSessionEvent(
      midTurn({ isCompacting: true }),
      compactionEnd({ willRetry: true, errorMessage: "summary failed" }),
    );

    expect(retrying.state.agentRunning).toBe(true);
    expect(retrying.effects).toEqual([{ kind: "show_compaction_error_toast", message: "summary failed" }]);

    const done = reduceSessionEvent(
      midTurn({ isCompacting: true }),
      compactionEnd({ errorMessage: "summary failed" }),
    );
    expect(kindsOf(done.effects)).toEqual([
      "settle_stream",
      "show_compaction_error_toast",
      "reload_session_after_compaction",
    ]);
  });

  it("mirrors the model's thinking level", () => {
    const reduction = reduceSessionEvent(createSessionRuntimeState(), {
      type: "thinking_level_changed",
      level: "high",
    });

    expect(reduction.state.thinkingLevel).toBe("high");
    expect(reduction.effects).toEqual([]);
  });

  it("counts the turn and phase events among the reduced events", () => {
    expect(isReducedSessionEvent(agentStart)).toBe(true);
    expect(isReducedSessionEvent(agentEnd())).toBe(true);
    expect(isReducedSessionEvent(compactionEnd())).toBe(true);
    expect(isReducedSessionEvent({ type: "thinking_level_changed", level: "off" })).toBe(true);
  });
});

// ── The protocol tail (#64) ──────────────────────────────────────────────
//
// #64 closes the port. The adapter holds no routing guard and no per-event
// `switch` any more: `reduceSessionEvent` is total over the protocol, so the
// 11 events the client deliberately ignores come back with the state untouched
// instead of being filtered out before the reducer. The three properties
// ADR-0007 asks the unit layer to pin live here — protocol completeness (the
// compiler plus the two disposition lists), replay idempotency, and the
// terminal migration from "start" through "running" to "closed".

/**
 * One sample of every deliberately-ignored event, i.e. of every protocol type
 * that is not in `REDUCED_SESSION_EVENTS`.
 *
 * The sample-per-type table is what keeps the written omission from becoming a
 * lie: moving a type between the two halves, or adding a new one to the ignored
 * list, fails the completeness assertion below until a sample is added — at
 * which point this test feeds it and asserts that nothing moves.
 */
const IGNORED_EVENT_SAMPLES: SessionEvent[] = [
  { type: "agent_settled" },
  { type: "turn_start" },
  { type: "turn_end", message: { role: "assistant" }, toolResults: [] },
  { type: "entry_appended", entry: { id: "e1" } },
  { type: "queue_update", steering: ["steer"], followUp: ["follow"] },
  { type: "session_info_changed", name: "renamed" },
  { type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 250, errorMessage: "x" },
  { type: "summarization_retry_attempt_start", source: "compaction", reason: "threshold" },
  { type: "summarization_retry_finished" },
  { type: "bash_execution_update", id: "bash-1", delta: "partial output" },
  { type: "connected", sessionId: "session-1" },
];

describe("session event protocol: the deliberately-ignored half", () => {
  it("has a sample for every ignored event, and none for a reduced one", () => {
    expect(IGNORED_EVENT_SAMPLES.map((event) => event.type).sort()).toEqual([...ignoredTypes].sort());
  });

  it("changes neither the state nor the effects, whatever the session was doing", () => {
    // A session in the middle of everything the ignored events could plausibly
    // have touched: running, compacting, with a message, a tool in flight and a
    // context estimate. If any ignored branch ever grows an opinion, one of
    // these fields moves and this test fails.
    const busy = midTurn({
      isCompacting: true,
      agentPhase: { kind: "running_tools", tools: [{ id: "call-1", name: "bash", args: { command: "ls" } }] },
      messages: [assistantMessage()] as unknown as SessionRuntimeState["messages"],
      inFlightTools: new Map([["call-1", { name: "bash", args: { command: "ls" } }]]),
      contextUsage: { percent: 10, contextWindow: 1000, tokens: 100 },
    });

    for (const event of IGNORED_EVENT_SAMPLES) {
      const reduction = reduceSessionEvent(busy, event);
      // Identity, not just equality: an ignored frame must not even churn the
      // state object, or every one of them would re-render the chat.
      expect(reduction.state, event.type).toBe(busy);
      expect(reduction.effects, event.type).toEqual([]);
    }
  });
});

describe("session event reducer: replay idempotency", () => {
  it("leaves the state, and the effects, where they were when any reduced event is fed twice", () => {
    const started = reduceSessionEvent(midTurn(), toolStart("call-1", "bash", { command: "ls" })).state;
    /** `replay: "silent"` marks the one event type whose replay must produce no
     *  effect at all, because re-asking would be user-visible twice; every other
     *  type re-asks for the same (idempotent) observations. */
    const cases: { name: string; state: SessionRuntimeState; event: SessionEvent; replay?: "silent" }[] = [
      { name: "permission_request", state: createSessionRuntimeState(), event: permissionEvent },
      {
        name: "ask_user_questions_request",
        state: createSessionRuntimeState(),
        event: askEvent("ask-1"),
        // The route re-sends a pending question on reconnect; re-emitting
        // `set_pending_ask_user_questions` + `play_ui_sound` would ring twice.
        replay: "silent",
      },
      { name: "tool_execution_start", state: midTurn(), event: toolStart("call-1", "bash", { command: "ls" }) },
      {
        name: "tool_execution_update",
        state: started,
        event: toolUpdate("call-1", "bash", { content: [{ type: "text", text: "partial" }] }),
      },
      {
        name: "tool_execution_end",
        state: started,
        event: toolEnd("call-1", "bash", { content: [{ type: "text", text: "done" }] }),
      },
      { name: "message_start", state: midTurn(), event: messageStart(assistantMessage()) },
      { name: "message_update", state: midTurn(), event: messageUpdate(assistantMessage()) },
      { name: "message_end", state: midTurn(), event: messageEnd(assistantMessage()) },
      {
        name: "session_tree_update",
        state: midTurn(),
        event: treeUpdate([{ type: "message", id: "e1", parentId: null, timestamp: "t" }], "e1"),
      },
      { name: "agent_start", state: midTurn(), event: agentStart },
      { name: "agent_end", state: midTurn({ lastAssistantIsBody: true }), event: agentEnd() },
      {
        name: "auto_retry_start",
        state: midTurn(),
        event: { type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 1000, errorMessage: "rate limited" },
      },
      { name: "auto_retry_end", state: midTurn(), event: { type: "auto_retry_end", success: true, attempt: 2 } },
      { name: "prompt_failed", state: midTurn(), event: { type: "prompt_failed", error: "no api key" } },
      { name: "compaction_start", state: midTurn(), event: { type: "compaction_start", reason: "threshold" } },
      {
        name: "compaction_end",
        state: midTurn({ isCompacting: true, agentPhase: { kind: "compacting" } }),
        event: compactionEnd(),
      },
      { name: "thinking_level_changed", state: midTurn(), event: { type: "thinking_level_changed", level: "high" } },
    ];

    // One row per reduced type: a new reduced event has to bring its own row, so
    // the property cannot be claimed for a type nobody fed twice.
    expect(cases.map((entry) => entry.name).sort()).toEqual([...reducedTypes].sort());

    for (const entry of cases) {
      const first = reduceSessionEvent(entry.state, entry.event);

      // An SSE reconnect (and a compaction replay) re-delivers frames; the same
      // frame twice must leave the same belief and ask for the same work, not a
      // second one.
      const replay = reduceSessionEvent(first.state, entry.event);

      expect(replay.state, entry.name).toEqual(first.state);
      if (entry.replay === "silent") {
        expect(replay.effects, entry.name).toEqual([]);
      } else {
        expect(replay.effects, entry.name).toEqual(first.effects);
      }
    }
  });

  it("re-asks for the same observations when message_end is replayed, without committing twice", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), messageEnd(assistantMessage()));

    const replay = reduceSessionEvent(first.state, messageEnd(assistantMessage()));

    expect(replay.state.messages).toEqual(first.state.messages);
    // The effects are the same observations: the streaming store flushes the
    // same final snapshot and the context refresh simply repeats. What must not
    // happen — and does not — is a second committed message or a second ring.
    expect(replay.effects).toEqual(first.effects);
  });

  it("does not move the tree when session_tree_update is replayed", () => {
    const tree = [{ type: "message", id: "e1", parentId: null, timestamp: "t" }];
    const first = reduceSessionEvent(createSessionRuntimeState(), treeUpdate(tree, "e1"));

    const replay = reduceSessionEvent(first.state, treeUpdate(tree, "e1"));

    expect(replay.state).toBe(first.state);
    expect(replay.effects).toEqual([]);
  });
});

describe("session event reducer: a turn from start to close", () => {
  it("walks 起 → 跑 → 收 and leaves nothing in flight", () => {
    let state = createSessionRuntimeState();

    // 起 — a new turn opens clean and running.
    state = reduceSessionEvent(state, agentStart).state;
    expect(state.agentRunning).toBe(true);
    expect(state.isCompacting).toBe(false);
    expect(state.agentPhase).toEqual({ kind: "waiting_model" });

    // 跑 — the assistant streams, a tool runs and finishes, the message settles.
    state = reduceSessionEvent(state, messageStart(assistantMessage())).state;
    expect(state.agentPhase).toBeNull();

    state = reduceSessionEvent(state, toolStart("call-1", "bash", { command: "ls" })).state;
    expect(state.inFlightTools.size).toBe(1);
    expect(state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "call-1", name: "bash", args: { command: "ls" } }],
    });

    state = reduceSessionEvent(state, toolEnd("call-1", "bash", { content: [{ type: "text", text: "ok" }] })).state;
    expect(state.inFlightTools.size).toBe(0);
    expect(state.agentPhase).toEqual({ kind: "waiting_model" });

    state = reduceSessionEvent(state, messageEnd(assistantMessage())).state;
    expect(state.messages).toHaveLength(1);
    expect(state.agentRunning).toBe(true);

    // 收 — agent_end closes every stage flag and leaves no tool behind.
    state = reduceSessionEvent(state, agentEnd()).state;
    expect(state.agentRunning).toBe(false);
    expect(state.isCompacting).toBe(false);
    expect(state.agentPhase).toBeNull();
    expect(state.retryInfo).toBeNull();
    expect(state.inFlightTools.size).toBe(0);
  });
});
