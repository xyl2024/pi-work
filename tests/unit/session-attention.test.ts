/**
 * The sidebar row shows at most ONE attention dot, and a session that is
 * blocked on a dangerous-command confirmation outranks one that is blocked on
 * an `ask_user_questions` card.
 *
 * Both facts are decided here, once, in a pure function: the two client
 * sources (`askUserQuestionsStore` and the pending-permission queue) are
 * merged before `SessionItem` sees anything, so the component never nests the
 * precedence rule inside its render.
 */
import { describe, expect, it } from "vitest";
import { sessionAttentionById } from "@/lib/shared/session-attention";

describe("sessionAttentionById", () => {
  it("maps a session with only a pending question to the question dot", () => {
    const attention = sessionAttentionById(["s1"], []);

    expect([...attention.entries()]).toEqual([["s1", "question"]]);
  });

  it("maps a session with only a pending confirmation to the permission dot", () => {
    const attention = sessionAttentionById([], ["s1"]);

    expect([...attention.entries()]).toEqual([["s1", "permission"]]);
  });

  it("lets the pending confirmation win when a session has both", () => {
    const attention = sessionAttentionById(["s1"], ["s1"]);

    expect(attention.get("s1")).toBe("permission");
  });

  it("keeps different sessions on their own dots", () => {
    const attention = sessionAttentionById(["s1"], ["s2"]);

    expect(attention.get("s1")).toBe("question");
    expect(attention.get("s2")).toBe("permission");
  });

  it("collapses several pending confirmations of one session into one entry", () => {
    // Two parallel bash calls can each open a gate; the row still has room
    // for exactly one dot.
    const attention = sessionAttentionById([], ["s1", "s1", "s1"]);

    expect(attention.size).toBe(1);
    expect(attention.get("s1")).toBe("permission");
  });

  it("is empty when nothing is pending", () => {
    expect(sessionAttentionById([], []).size).toBe(0);
  });
});
