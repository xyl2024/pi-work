import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InteractionGates,
  type PermissionGateRequest,
} from "@/lib/server/interaction-gates";
import type { SessionEvent } from "@/lib/shared/session-events";

/**
 * Tests for the interaction gates.
 *
 * The only seam is the module's public interface (docs/adr/0008-…): a gate is
 * opened, decided and torn down through it, and the assertions are about the
 * events it emits, the decision it hands back, and the one sentence it refuses
 * with. No pi SDK, no HTTP, no React, no private fields.
 */

function makeGates(source = "user") {
  const emitted: SessionEvent[] = [];
  const gates = new InteractionGates({
    source,
    emit: (event) => emitted.push(event),
  });
  return { gates, emitted };
}

const bashGate = (over: Partial<PermissionGateRequest> = {}): PermissionGateRequest => ({
  toolCallId: "call-1",
  rule: "rm-rf",
  command: "rm -rf /",
  what: 'the dangerous-command rule "rm-rf"',
  timeoutMs: null,
  ...over,
});

describe("opening and deciding a gate", () => {
  it("emits the wire event and hands the decision back to the waiter", async () => {
    const { gates, emitted } = makeGates();
    const pending = gates.runPermissionGate(bashGate());

    expect(emitted).toEqual([
      {
        type: "permission_request",
        toolCallId: "call-1",
        ruleName: "rm-rf",
        command: "rm -rf /",
      },
    ]);

    expect(gates.resolvePermission("call-1", "allow_once")).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "allow" });
  });

  it("returns false for a gate that does not exist instead of throwing", () => {
    const { gates } = makeGates();
    expect(gates.resolvePermission("never-opened", "allow_once")).toBe(false);
  });
});

describe("one gate per tool call id", () => {
  it("does not open a second gate for the same id, and settles every waiter", async () => {
    const { gates, emitted } = makeGates();
    const first = gates.runPermissionGate(bashGate());
    const second = gates.runPermissionGate(bashGate({ command: "rm -rf /tmp" }));

    expect(emitted).toHaveLength(1);

    gates.resolvePermission("call-1", "allow_once");
    await expect(first).resolves.toEqual({ decision: "allow" });
    await expect(second).resolves.toEqual({ decision: "allow" });
  });
});

describe("refusing", () => {
  it("turns the user's denial into a reason", async () => {
    const { gates } = makeGates();
    const pending = gates.runPermissionGate(bashGate());

    gates.resolvePermission("call-1", "deny");
    await expect(pending).resolves.toEqual({
      decision: "deny",
      reason: "Denied by user",
    });
  });

  it("names what was denied when the call site says so", async () => {
    const { gates } = makeGates();
    const pending = gates.runPermissionGate(
      bashGate({ deniedSubject: "index creation" }),
    );

    gates.resolvePermission("call-1", "deny");
    await expect(pending).resolves.toEqual({
      decision: "deny",
      reason: "Denied by user: index creation",
    });
  });

  it("refuses a subagent outright, with a readable reason and no gate at all", async () => {
    const { gates, emitted } = makeGates("subagent");
    const outcome = await gates.runPermissionGate(bashGate());

    expect(outcome.decision).toBe("deny");
    const reason = outcome.decision === "deny" ? outcome.reason : "";
    expect(reason).toContain('the dangerous-command rule "rm-rf"');
    expect(reason).toContain("subagent session");
    expect(emitted).toEqual([]);
    expect(gates.resolvePermission("call-1", "allow_once")).toBe(false);
  });
});

describe("always allow", () => {
  it("remembers only its own rule, for this session", async () => {
    const { gates, emitted } = makeGates();

    const remembered = gates.runPermissionGate(bashGate());
    gates.resolvePermission("call-1", "allow_similar");
    await expect(remembered).resolves.toEqual({ decision: "allow" });

    await expect(
      gates.runPermissionGate(bashGate({ toolCallId: "call-2" })),
    ).resolves.toEqual({ decision: "allow" });
    expect(emitted).toHaveLength(1);

    const other = gates.runPermissionGate(
      bashGate({
        toolCallId: "call-3",
        rule: "git-push",
        command: "git push --force",
        what: 'the dangerous-command rule "git-push"',
      }),
    );
    expect(emitted).toHaveLength(2);

    gates.resolvePermission("call-3", "allow_once");
    await expect(other).resolves.toEqual({ decision: "allow" });
  });
});

describe("deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-denies at the deadline and drops the gate", async () => {
    vi.useFakeTimers();
    const { gates } = makeGates();
    const pending = gates.runPermissionGate(bashGate({ timeoutMs: 300_000 }));

    vi.advanceTimersByTime(300_000);
    await expect(pending).resolves.toEqual({
      decision: "deny",
      reason: "Denied by user",
    });
    expect(gates.resolvePermission("call-1", "allow_once")).toBe(false);
  });

  it("never reaps a gate that was given no deadline", async () => {
    vi.useFakeTimers();
    const { gates } = makeGates();
    const pending = gates.runPermissionGate(bashGate({ timeoutMs: null }));

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(gates.resolvePermission("call-1", "deny")).toBe(true);
    await expect(pending).resolves.toEqual({
      decision: "deny",
      reason: "Denied by user",
    });
  });
});

describe("tearing down with the session", () => {
  it("invalidates every open gate and forgets the session memo", async () => {
    const { gates, emitted } = makeGates();

    const remembered = gates.runPermissionGate(bashGate());
    gates.resolvePermission("call-1", "allow_similar");
    await expect(remembered).resolves.toEqual({ decision: "allow" });

    const openA = gates.runPermissionGate(
      bashGate({ toolCallId: "call-2", rule: "git-push" }),
    );
    const openB = gates.runPermissionGate(
      bashGate({ toolCallId: "call-3", rule: "chmod-777", command: "chmod -R 777 ." }),
    );

    gates.invalidateAll();
    // The wrapper has always rejected with the bare string "destroyed";
    // the agent sees the same failure it saw before the move.
    await expect(openA).rejects.toBe("destroyed");
    await expect(openB).rejects.toBe("destroyed");
    expect(gates.resolvePermission("call-2", "allow_once")).toBe(false);

    // The memo went with it: the "always allowed" rule asks again.
    const again = gates.runPermissionGate(bashGate({ toolCallId: "call-4" }));
    expect(emitted).toHaveLength(4);
    gates.resolvePermission("call-4", "deny");
    await expect(again).resolves.toEqual({
      decision: "deny",
      reason: "Denied by user",
    });
  });
});
