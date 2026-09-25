/**
 * The transcript a disk read brings back must not delete what the user just
 * typed.
 *
 * Regression: sending a prompt immediately after a reply finishes loses the
 * prompt. `agent_end` both re-enables the input and (as the
 * `reload_session_after_turn` effect) fires `GET /api/sessions/[id]`, which
 * writes its `context.messages` straight into the runtime state. A prompt sent
 * inside that round trip is appended synchronously and then overwritten by the
 * older snapshot. Because the prompt is gone, `ChatWindow`'s `lastUserIdx`
 * falls back to the previous turn's prompt, so the *next* assistant stream
 * renders inside the previous turn's viewport.
 *
 * These tests drive the real reducer and the real patch helper in the exact
 * order the client performs them.
 */
import { describe, expect, it } from "vitest";
import { buildChatTimeline } from "@/lib/shared/chat-timeline";
import { reduceSessionInput } from "@/lib/shared/session-events";
import {
  adoptDiskTranscript,
  createSessionRuntimeState,
  patchSessionRuntimeState,
} from "@/lib/shared/session-runtime-state";
import type { AgentMessage } from "@/lib/shared/types";

const user1: AgentMessage = { role: "user", content: "first", timestamp: 1_000 };
const assistant1: AgentMessage = {
  role: "assistant",
  content: [{ type: "text", text: "answer one" }],
  model: "m",
  provider: "p",
  stopReason: "stop",
  timestamp: 2_000,
};
const user2: AgentMessage = { role: "user", content: "second", timestamp: 3_000 };

/** The write `loadSession` performs, in the order it performs it. */
function applyDiskTranscript(state: ReturnType<typeof createSessionRuntimeState>, disk: AgentMessage[]) {
  return patchSessionRuntimeState(state, "messages", (previous) => adoptDiskTranscript(previous, disk));
}

describe("adoptDiskTranscript", () => {
  it("keeps a prompt the user appended while the transcript read was in flight", () => {
    expect(adoptDiskTranscript([user1, assistant1, user2], [user1, assistant1])).toEqual([
      user1,
      assistant1,
      user2,
    ]);
  });

  it("adopts a transcript that reaches further than the local one", () => {
    expect(adoptDiskTranscript([user1], [user1, assistant1])).toEqual([user1, assistant1]);
  });

  it("adopts a transcript that diverges from the local one", () => {
    const otherBranch: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "other branch" }],
      model: "m",
      provider: "p",
      stopReason: "stop",
      timestamp: 4_000,
    };
    expect(adoptDiskTranscript([user1, assistant1], [user1, otherBranch])).toEqual([user1, otherBranch]);
  });

  it("is a no-op when the two transcripts agree", () => {
    expect(adoptDiskTranscript([user1, assistant1], [user1, assistant1])).toEqual([user1, assistant1]);
  });

  it("keeps the local tail even when the snapshot diverged under it", () => {
    const otherBranch: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "other branch" }],
      model: "m",
      provider: "p",
      stopReason: "stop",
      timestamp: 5_000,
    };
    expect(adoptDiskTranscript([user1, assistant1, user2], [user1, otherBranch])).toEqual([
      user1,
      otherBranch,
      user2,
    ]);
  });
});

describe("turn end followed by an immediate send", () => {
  it("does not lose the sent prompt when the turn-end reload lands late", () => {
    // Loaded when the previous turn ended.
    let state = createSessionRuntimeState({ messages: [user1, assistant1] });
    // The snapshot the turn-end reload read, before the user's next prompt
    // reached the server.
    const snapshotRead = [user1, assistant1];

    // `agent_end` closes the turn (input enabled) and asks for the reload.
    const turnEnd = reduceSessionInput(state, { type: "agent_end", messages: [], willRetry: false });
    state = turnEnd.state;
    expect(turnEnd.effects).toContainEqual({ kind: "reload_session_after_turn" });
    expect(state.agentRunning).toBe(false);

    // The user sends: `handleSend` appends the prompt synchronously.
    state = patchSessionRuntimeState(state, "messages", (previous) => [...previous, user2]);
    expect(state.messages).toEqual([user1, assistant1, user2]);

    // The reload response lands.
    state = applyDiskTranscript(state, snapshotRead);

    expect(state.messages).toEqual([user1, assistant1, user2]);

    // The user-visible symptom: `ChatWindow` anchors the live-turn viewport on
    // the last user row, so a transcript ending at the *previous* prompt would
    // render the next assistant stream under that earlier turn.
    const timeline = buildChatTimeline({
      messages: state.messages,
      entryIds: ["e1", "e2"],
      entryTimestamps: [],
    });
    expect(timeline.visibleMessages.at(-1)).toEqual(user2);
  });
});
