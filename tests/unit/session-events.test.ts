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

const malformedAskEvent = {
  type: "ask_user_questions_request",
  toolCallId: "ask-bad",
  ts: 1,
  questions: [{ question: "no options", header: "Bad" }],
} as unknown as SessionEvent;

describe("session event reducer", () => {
  it("reduces a permission request into its effects and claims the id", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, permissionEvent);

    expect(reduction.state).toBe(state);
    expect(state.seenPermissionRequestToolCallIds.has("call-1")).toBe(true);
    expect(reduction.effects).toEqual([
      {
        kind: "enqueue_permission_request",
        toolCallId: "call-1",
        ruleName: "rm",
        command: "rm -rf /tmp/x",
      },
      { kind: "play_ui_sound", sound: "permission_request" },
    ]);
  });

  it("does not ring twice when the server replays a pending permission request", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), permissionEvent);

    const replay = reduceSessionEvent(first.state, permissionEvent);

    expect(replay.state).toBe(first.state);
    expect(replay.effects).toEqual([]);
  });

  it("isolates the permission-request ledger per session", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();
    reduceSessionEvent(a, permissionEvent);

    const inB = reduceSessionEvent(b, permissionEvent);

    expect(inB.effects.map((effect) => effect.kind))
      .toEqual(["enqueue_permission_request", "play_ui_sound"]);
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
    for (const type of reducedTypes) {
      expect(isReducedSessionEvent({ type } as SessionEvent)).toBe(true);
    }
    for (const type of ignoredTypes) {
      expect(isReducedSessionEvent({ type } as SessionEvent)).toBe(false);
    }
  });
});

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
    expect(reduction.effects).toEqual([]);
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

  it("flashes the bot only for a failed tool call", () => {
    const failed = reduceSessionEvent(createSessionRuntimeState(), toolEnd("call-1", "bash", undefined, true));
    expect(failed.effects).toContainEqual({ kind: "flash_bot_state", stateKey: "suspicious" });

    const ok = reduceSessionEvent(createSessionRuntimeState(), toolEnd("call-2", "bash", undefined, false));
    expect(kindsOf(ok.effects)).not.toContain("flash_bot_state");
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

type MessageStartEvent = Extract<SessionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<SessionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<SessionEvent, { type: "message_end" }>;
type TreeUpdateEvent = Extract<SessionEvent, { type: "session_tree_update" }>;

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
    const first = reduceSessionEvent(createSessionRuntimeState(), messageEnd(assistantMessage()));
    const second = reduceSessionEvent(first.state, messageEnd(assistantMessage({ timestamp: 2 })));
    expect(second.state.messages).toHaveLength(2);

    const toolA = reduceSessionEvent(createSessionRuntimeState(), messageEnd({ role: "toolResult", toolCallId: "a", content: [] }));
    const toolB = reduceSessionEvent(toolA.state, messageEnd({ role: "toolResult", toolCallId: "b", content: [] }));
    expect(toolB.state.messages).toHaveLength(2);
  });

  it("replaces an optimistic skill command with the expanded user message before the turn ends", () => {
    const state = patchSessionRuntimeState(createSessionRuntimeState(), "messages", [
      { role: "user", content: "/skill:tdd fix this\nwith tests", timestamp: 1 },
    ]);
    const content = '<skill name="tdd" location="/skills/tdd/SKILL.md">\nSkill instructions\n</skill>\n\nfix this\nwith tests';
    const event = messageEnd({ role: "user", content: [{ type: "text", text: content }], timestamp: 2 });

    const reduction = reduceSessionEvent(state, event);

    expect(reduction.state.messages).toEqual([
      { role: "user", content: [{ type: "text", text: content }], timestamp: 1 },
    ]);
    expect(reduceSessionEvent(reduction.state, event).state.messages).toBe(reduction.state.messages);
  });

  it("preserves image attachments and metadata when expanding a skill with an origin", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "image-data" } } as const;
    const state = patchSessionRuntimeState(createSessionRuntimeState(), "messages", [
      { role: "user", content: [{ type: "text", text: "/skill:tdd" }, image], timestamp: 1 },
    ]);
    const content = [
      { type: "text", text: '<skill name="tdd" location="/skills/tdd/SKILL.md">\nInstructions\n</skill>' },
      image,
    ];
    const reduction = reduceSessionEvent(state, {
      ...messageEnd({ role: "user", content, timestamp: 2 }),
      origin: { kind: "web" },
    });

    expect(reduction.state.messages).toEqual([
      { role: "user", content, timestamp: 1, origin: { kind: "web" } },
    ]);
  });

  it("does not append a skill message when there is no optimistic user message", () => {
    const reduction = reduceSessionEvent(createSessionRuntimeState(), messageEnd({
      role: "user",
      content: '<skill name="tdd" location="/skills/tdd/SKILL.md">\nInstructions\n</skill>',
    }));

    expect(reduction.state.messages).toEqual([]);
  });

  it.each([
    "/skill:other fix this",
    "/skill:tdd different arguments",
    "ordinary message",
  ])("does not replace an unrelated user message: %s", (content) => {
    const state = patchSessionRuntimeState(createSessionRuntimeState(), "messages", [
      { role: "user", content, timestamp: 1 },
    ]);
    const reduction = reduceSessionEvent(state, messageEnd({
      role: "user",
      content: '<skill name="tdd" location="/skills/tdd/SKILL.md">\nInstructions\n</skill>\n\nfix this',
    }));

    expect(reduction.state.messages).toBe(state.messages);
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
      "refresh_system_prompt",
      "set_bot_baseline",
    ]);
  });

  it("does not clear a pending error when a new turn starts", () => {
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

  it("mirrors the session's permission mode", () => {
    const reduction = reduceSessionEvent(createSessionRuntimeState(), {
      type: "permission_mode_changed",
      mode: "full_access",
    });

    expect(reduction.state.permissionMode).toBe("full_access");
    expect(reduction.effects).toEqual([]);
  });

  it("leaves the permission mode alone when the wire value is not a mode", () => {
    const fullAccess = createSessionRuntimeState({ permissionMode: "full_access" });
    const reduction = reduceSessionEvent(fullAccess, {
      type: "permission_mode_changed",
      mode: "yolo" as never,
    });

    expect(reduction.state).toBe(fullAccess);
    expect(reduction.state.permissionMode).toBe("full_access");

    const missing = reduceSessionEvent(createSessionRuntimeState(), {
      type: "permission_mode_changed",
    } as never);
    expect(missing.state.permissionMode).toBe("confirm");
  });

  it("counts the turn and phase events among the reduced events", () => {
    expect(isReducedSessionEvent(agentStart)).toBe(true);
    expect(isReducedSessionEvent(agentEnd())).toBe(true);
    expect(isReducedSessionEvent(compactionEnd())).toBe(true);
    expect(isReducedSessionEvent({ type: "thinking_level_changed", level: "off" })).toBe(true);
    expect(isReducedSessionEvent({ type: "permission_mode_changed", mode: "confirm" })).toBe(true);
  });
});

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
    const busy = midTurn({
      isCompacting: true,
      agentPhase: { kind: "running_tools", tools: [{ id: "call-1", name: "bash", args: { command: "ls" } }] },
      messages: [assistantMessage()] as unknown as SessionRuntimeState["messages"],
      inFlightTools: new Map([["call-1", { name: "bash", args: { command: "ls" } }]]),
      contextUsage: { percent: 10, contextWindow: 1000, tokens: 100 },
    });

    for (const event of IGNORED_EVENT_SAMPLES) {
      const reduction = reduceSessionEvent(busy, event);
      expect(reduction.state, event.type).toBe(busy);
      expect(reduction.effects, event.type).toEqual([]);
    }
  });
});

describe("session event reducer: replay idempotency", () => {
  it("leaves the state, and the effects, where they were when any reduced event is fed twice", () => {
    const started = reduceSessionEvent(midTurn(), toolStart("call-1", "bash", { command: "ls" })).state;
    const cases: { name: string; state: SessionRuntimeState; event: SessionEvent; replay?: "silent" }[] = [
      {
        name: "permission_request",
        state: createSessionRuntimeState(),
        event: permissionEvent,
        replay: "silent",
      },
      {
        name: "ask_user_questions_request",
        state: createSessionRuntimeState(),
        event: askEvent("ask-1"),
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
      {
        name: "permission_mode_changed",
        state: midTurn(),
        event: { type: "permission_mode_changed", mode: "full_access" },
      },
    ];

    expect(cases.map((entry) => entry.name).sort()).toEqual([...reducedTypes].sort());

    for (const entry of cases) {
      const first = reduceSessionEvent(entry.state, entry.event);

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

    state = reduceSessionEvent(state, agentStart).state;
    expect(state.agentRunning).toBe(true);
    expect(state.isCompacting).toBe(false);
    expect(state.agentPhase).toEqual({ kind: "waiting_model" });

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

    state = reduceSessionEvent(state, agentEnd()).state;
    expect(state.agentRunning).toBe(false);
    expect(state.isCompacting).toBe(false);
    expect(state.agentPhase).toBeNull();
    expect(state.retryInfo).toBeNull();
    expect(state.inFlightTools.size).toBe(0);
  });
});
