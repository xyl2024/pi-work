import { describe, expect, it } from "vitest";
import {
  runTurn,
  watchSettled,
  type AcquiredTurnSession,
  type RunTurnSpec,
  type TurnEvent,
  type TurnSessionFactory,
  type TurnSession,
} from "@/lib/server/turn";

/**
 * Orchestration tests for the turn module, driven by fake sessions.
 *
 * Per the module's testing decisions (docs/adr/0004-…): these assert outward
 * behaviour — which terminal state a scripted event sequence produces and
 * which commands reach the session — not internal call order or private
 * state. The one ordering rule pinned here ("the listener exists the moment
 * the prompt is delivered") is observable through the fake: the prompt
 * delivery itself settles the turn synchronously.
 */

const settledAssistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

class FakeTurnSession implements TurnSession {
  readonly sent: Record<string, unknown>[] = [];
  private readonly eventListeners = new Set<(event: TurnEvent) => void>();
  private readonly destroyCallbacks = new Set<() => void>();
  destroyed = 0;
  /** When true, delivering the prompt settles the turn synchronously (a "very short turn"). */
  settleOnPrompt = false;

  constructor(readonly sessionId: string) {}

  onEvent(listener: (event: TurnEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onDestroy(cb: () => void): () => void {
    this.destroyCallbacks.add(cb);
    return () => this.destroyCallbacks.delete(cb);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.sent.push(command);
    if (command.type === "prompt" && this.settleOnPrompt) {
      this.emit({ type: "agent_end", willRetry: false, messages: [settledAssistant("quick")] });
      this.emit({ type: "agent_settled" });
    }
    return null;
  }

  destroy(): void {
    this.destroyed += 1;
    for (const cb of [...this.destroyCallbacks]) cb();
  }

  emit(event: TurnEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }
}

interface FactoryCall {
  cwd: string;
  toolNames: string[] | "all" | undefined;
  source: string;
}

function makeFactory(sessions: FakeTurnSession[], calls: FactoryCall[], failure?: Error): TurnSessionFactory {
  return async (cwd, toolNames, source) => {
    calls.push({ cwd, toolNames, source });
    if (failure) throw failure;
    const session = sessions[0];
    if (!session) throw new Error("fake session exhausted");
    const acquired: AcquiredTurnSession = {
      session,
      sessionId: `key-${sessions.indexOf(session) + 1}`,
      realSessionId: session.sessionId,
    };
    return acquired;
  };
}

function baseSpec(overrides: Partial<RunTurnSpec> = {}): RunTurnSpec {
  return { cwd: "/tmp/project", prompt: "do the thing", timeoutMs: 5_000, ...overrides };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("runTurn — one call runs the whole turn", () => {
  it("opens a session, prepares it, delivers the prompt and returns the neutral result", async () => {
    const sessions: FakeTurnSession[] = [];
    const calls: FactoryCall[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);
    session.settleOnPrompt = true;
    const factory = makeFactory(sessions, calls);

    const result = await runTurn(
      baseSpec({
        model: { provider: "anthropic", modelId: "claude-x" },
        thinkingLevel: "high",
        toolNames: ["read"],
        source: "scheduled",
      }),
      factory,
    );

    expect(result.status).toBe("completed");
    expect(result.text).toBe("quick");
    expect(result.hasReply).toBe(true);
    expect(result.error).toBeNull();
    expect(result.stopReason).toBe("end_turn");
    expect(result.sessionId).toBe("key-1");
    expect(result.realSessionId).toBe("real-1");
    expect(calls).toEqual([{ cwd: "/tmp/project", toolNames: ["read"], source: "scheduled" }]);
    expect(session.sent.map((command) => command.type)).toEqual(["set_model", "set_thinking_level", "prompt"]);
    expect(session.sent[0]).toEqual({ type: "set_model", provider: "anthropic", modelId: "claude-x" });
    expect(session.sent[1]).toEqual({ type: "set_thinking_level", level: "high" });
    expect(session.sent[2]).toEqual({ type: "prompt", message: "do the thing" });
  });

  it("has the terminal listener in place the moment the prompt is delivered", async () => {
    // settleOnPrompt settles the turn synchronously inside send(): if the
    // listener were installed after the prompt (the old wechat drift), the
    // settle would be missed and the wait would only end at the deadline.
    const sessions: FakeTurnSession[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);
    session.settleOnPrompt = true;

    const result = await runTurn(baseSpec({ timeoutMs: 120_000 }), makeFactory(sessions, []));
    expect(result.status).toBe("completed");
  });

  it("sends no setup commands when model/thinking/tools are absent and lets the factory default the tools", async () => {
    const sessions: FakeTurnSession[] = [];
    const calls: FactoryCall[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);
    session.settleOnPrompt = true;

    const result = await runTurn(baseSpec(), makeFactory(sessions, calls));

    expect(session.sent.map((command) => command.type)).toEqual(["prompt"]);
    // toolNames undefined → the factory applies its own default (sidecar / cwd
    // default); the module never invents one. source defaults to "user".
    expect(calls).toEqual([{ cwd: "/tmp/project", toolNames: undefined, source: "user" }]);
    expect(result.status).toBe("completed");
  });

  it("waits for agent_settled — a retrying agent_end does not end the turn", async () => {
    const sessions: FakeTurnSession[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);

    const turn = runTurn(baseSpec(), makeFactory(sessions, []));
    await tick();
    session.emit({
      type: "agent_end",
      willRetry: true,
      messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "rate limited" }],
    });
    await tick();
    session.emit({ type: "agent_end", willRetry: false, messages: [settledAssistant("recovered")] });
    session.emit({ type: "agent_settled" });

    const result = await turn;
    expect(result.status).toBe("completed");
    expect(result.text).toBe("recovered");
  });

  it("returns interrupted instead of hanging when the session is destroyed while waiting", async () => {
    const sessions: FakeTurnSession[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);

    const turn = runTurn(baseSpec(), makeFactory(sessions, []));
    await tick();
    session.destroy();

    const result = await turn;
    expect(result.status).toBe("interrupted");
    expect(result.error).toBeTruthy();
  });

  it("destroys the session and reports timeout at the caller's deadline", async () => {
    const sessions: FakeTurnSession[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);

    const result = await runTurn(baseSpec({ timeoutMs: 10 }), makeFactory(sessions, []));

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("10");
    expect(session.destroyed).toBe(1);
  });

  it("announces the acquired session before any command reaches it", async () => {
    const session = new FakeTurnSession("real-1");
    session.settleOnPrompt = true;
    const seen: Array<{ sessionId: string; realSessionId: string; commandsSoFar: number }> = [];

    await runTurn(
      baseSpec({
        onSession: (ids) => seen.push({ ...ids, commandsSoFar: session.sent.length }),
      }),
      makeFactory([session], []),
    );

    // key-1 / real-1 come from the factory; commandsSoFar is 0 because the hook
    // fires right after acquisition, before set_model / set_thinking_level / prompt.
    expect(seen).toEqual([{ sessionId: "key-1", realSessionId: "real-1", commandsSoFar: 0 }]);
  });

  it("destroys the session when the onSession callback throws", async () => {
    const session = new FakeTurnSession("real-1");
    const factory = makeFactory([session], []);

    await expect(
      runTurn(
        baseSpec({
          onSession: () => {
            throw new Error("card gone");
          },
        }),
        factory,
      ),
    ).rejects.toThrow("card gone");

    // The callback failed before any command reached the session: tear it down
    // rather than leak a session the caller could never link.
    expect(session.destroyed).toBe(1);
    expect(session.sent).toEqual([]);
  });

  it("reports failed when the prompt dispatch itself fails", async () => {
    const session = new FakeTurnSession("real-1");
    const factory = makeFactory([session], []);
    session.send = async (command: Record<string, unknown>) => {
      if (command.type === "prompt") throw new Error("rpc down");
      session.sent.push(command);
      return null;
    };
    const result = await runTurn(baseSpec(), factory);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("rpc down");
  });

  it("reports failed on a prompt_failed event", async () => {
    const sessions: FakeTurnSession[] = [];
    const session = new FakeTurnSession("real-1");
    sessions.push(session);

    const turn = runTurn(baseSpec(), makeFactory(sessions, []));
    await tick();
    session.emit({ type: "prompt_failed", error: "missing api key" });

    const result = await turn;
    expect(result.status).toBe("failed");
    expect(result.error).toBe("missing api key");
  });

  it("destroys the session when the setup commands fail", async () => {
    const session = new FakeTurnSession("real-1");
    const factory = makeFactory([session], []);
    session.send = async (command: Record<string, unknown>) => {
      session.sent.push(command);
      if (command.type === "set_model") throw new Error("Model not found: bad/model");
      return null;
    };

    await expect(runTurn(baseSpec({ model: { provider: "bad", modelId: "model" } }), factory)).rejects.toThrow(
      "Model not found: bad/model",
    );
    expect(session.destroyed).toBe(1);
    expect(session.sent.map((command) => command.type)).toEqual(["set_model"]);
  });

  it("propagates a factory failure", async () => {
    const factory = makeFactory([], [], new Error("cwd missing"));
    await expect(runTurn(baseSpec(), factory)).rejects.toThrow("cwd missing");
  });
});

describe("runTurn — the wait reuses the watchSettled judgement", () => {
  const scripted = async (
    run: (session: FakeTurnSession) => Promise<{ status: string; text: string }>,
    script: (session: FakeTurnSession) => void,
  ) => {
    const session = new FakeTurnSession("real-1");
    const promise = run(session);
    await tick();
    script(session);
    return { result: await promise, session };
  };

  it("runTurn and watchSettled agree on interrupted", async () => {
    const viaRun = await scripted(
      (session) => runTurn(baseSpec(), makeFactory([session], [])),
      (session) => session.destroy(),
    );
    const viaWatch = await scripted(
      (session) => watchSettled(session),
      (session) => session.destroy(),
    );
    expect(viaRun.result.status).toBe("interrupted");
    expect(viaWatch.result.status).toBe("interrupted");
  });

  it("runTurn and watchSettled agree on timeout (session destroyed, deadline reported)", async () => {
    const viaRun = await scripted(
      (session) => runTurn(baseSpec({ timeoutMs: 10 }), makeFactory([session], [])),
      () => undefined,
    );
    const viaWatch = await scripted(
      (session) => watchSettled(session, { timeoutMs: 10 }),
      () => undefined,
    );
    expect(viaRun.result.status).toBe("timeout");
    expect(viaRun.session.destroyed).toBe(1);
    expect(viaWatch.result.status).toBe("timeout");
    expect(viaWatch.session.destroyed).toBe(1);
  });

  it("runTurn and watchSettled agree that a retried turn still lands on the final attempt", async () => {
    const script = (session: FakeTurnSession) => {
      session.emit({ type: "agent_end", willRetry: true, messages: [] });
      session.emit({ type: "agent_end", willRetry: false, messages: [settledAssistant("final")] });
      session.emit({ type: "agent_settled" });
    };
    const viaRun = await scripted((session) => runTurn(baseSpec(), makeFactory([session], [])), script);
    const viaWatch = await scripted((session) => watchSettled(session), script);
    expect(viaRun.result.status).toBe("completed");
    expect(viaRun.result.text).toBe("final");
    expect(viaWatch.result.status).toBe("completed");
    expect(viaWatch.result.text).toBe("final");
  });
});

describe("watchSettled — observe only", () => {
  it("delivers no command to the session", async () => {
    const session = new FakeTurnSession("shared");

    const watch = watchSettled(session);
    await tick();
    expect(session.sent).toEqual([]);
    session.emit({ type: "agent_end", willRetry: false, messages: [settledAssistant("observed")] });
    session.emit({ type: "agent_settled" });

    const result = await watch;
    expect(result.status).toBe("completed");
    expect(result.text).toBe("observed");
    expect(session.sent).toEqual([]);
    expect(result.sessionId).toBe("shared");
    expect(result.realSessionId).toBe("shared");
  });

  it("converges with interrupted when the observed session is destroyed", async () => {
    const session = new FakeTurnSession("shared");

    const watch = watchSettled(session);
    await tick();
    session.destroy();

    const result = await watch;
    expect(result.status).toBe("interrupted");
  });

  it("honours an optional deadline without dispatching anything", async () => {
    const session = new FakeTurnSession("shared");

    const result = await watchSettled(session, { timeoutMs: 10 });

    expect(result.status).toBe("timeout");
    expect(session.destroyed).toBe(1);
    expect(session.sent).toEqual([]);
  });
});
