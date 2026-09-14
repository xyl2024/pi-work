import { describe, expect, it } from "vitest";
import { EMPTY_REPLY_FALLBACK, toInboundReply } from "@/lib/server/wechat/inbound-reply";
import type { TurnResult } from "@/lib/server/turn";

/**
 * The wechat channel's mapping from a turn result to the reply it sends back.
 *
 * Pure — no session, no SQLite — so this channel's reply policy is asserted
 * directly: an empty reply counts as a *success* answered with the fallback
 * line (wechat's documented current behaviour, unlike the scheduler and the
 * board), a timeout keeps the channel's own wording, and every other failure
 * carries the turn module's error text.
 */

function result(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    status: "completed",
    text: "",
    hasReply: false,
    error: null,
    stopReason: null,
    sessionId: "key-1",
    realSessionId: "real-1",
    ...overrides,
  };
}

const TIMEOUT_MS = 5 * 60 * 1000;

describe("toInboundReply — success", () => {
  it("replies with the agent's text on a clean completion", () => {
    expect(toInboundReply(result({ text: "全部测试通过", hasReply: true, stopReason: "end_turn" }), TIMEOUT_MS)).toEqual({
      ok: true,
      text: "全部测试通过",
      error: null,
    });
  });

  it("treats a completed turn with no reply text as success and answers with the fallback", () => {
    expect(toInboundReply(result({ status: "completed", text: "", hasReply: false }), TIMEOUT_MS)).toEqual({
      ok: true,
      text: EMPTY_REPLY_FALLBACK,
      error: null,
    });
  });

  it("keeps the reply verbatim, untrimmed", () => {
    const text = "line one\nline two\n";
    expect(toInboundReply(result({ text, hasReply: true }), TIMEOUT_MS).text).toBe(text);
  });
});

describe("toInboundReply — failure", () => {
  it("reports a timeout with the channel's own wording and the caller's deadline", () => {
    expect(
      toInboundReply(result({ status: "timeout", hasReply: false, error: "max lifetime exceeded: 300000ms" }), 1234),
    ).toEqual({ ok: false, text: "", error: "agent_end timed out after 1234ms" });
  });

  it("carries the turn module's error for a failed turn", () => {
    expect(toInboundReply(result({ status: "failed", hasReply: false, error: "missing api key" }), TIMEOUT_MS)).toEqual({
      ok: false,
      text: "",
      error: "missing api key",
    });
  });

  it("carries the turn module's error for an aborted turn", () => {
    expect(
      toInboundReply(result({ status: "aborted", hasReply: false, error: "assistant stopReason=aborted" }), TIMEOUT_MS),
    ).toEqual({ ok: false, text: "", error: "assistant stopReason=aborted" });
  });

  it("carries the turn module's error for an interrupted turn", () => {
    expect(
      toInboundReply(
        result({ status: "interrupted", hasReply: false, error: "agent session destroyed before agent_end" }),
        TIMEOUT_MS,
      ),
    ).toEqual({ ok: false, text: "", error: "agent session destroyed before agent_end" });
  });

  it("carries the turn module's error for a cancelled turn", () => {
    expect(
      toInboundReply(result({ status: "cancelled", hasReply: false, error: "Parent stopped" }), TIMEOUT_MS),
    ).toEqual({ ok: false, text: "", error: "Parent stopped" });
  });

  it("falls back to a generic reason when a non-completed turn gives no error", () => {
    expect(toInboundReply(result({ status: "failed", error: null }), TIMEOUT_MS).error).toBe("turn failed");
    expect(toInboundReply(result({ status: "interrupted", error: null }), TIMEOUT_MS).error).toBe("turn interrupted");
    expect(toInboundReply(result({ status: "cancelled", error: null }), TIMEOUT_MS).error).toBe("turn cancelled");
  });

  it("never sends a reply body on a failure", () => {
    const reply = toInboundReply(result({ status: "failed", hasReply: true, text: "partial", error: "boom" }), TIMEOUT_MS);
    expect(reply).toEqual({ ok: false, text: "", error: "boom" });
  });
});
