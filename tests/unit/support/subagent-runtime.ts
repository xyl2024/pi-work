import type { RunTurnSpec, TurnResult, TurnSessionFactory } from "@/lib/server/turn";
import type {
  SubagentChildSession,
  SubagentTaskTimers,
} from "@/lib/server/subagent-tasks";

/**
 * Shared scripted runtime for the subagent lifecycle tests.
 *
 * A turn is a deferred the test settles by hand, so no test ever waits on a
 * model; the child session is a structural fake; the timer stub records wait
 * deadlines and only fires when the test says so. Keeping one copy means the
 * task, wait and cancel suites exercise the same seams instead of drifting.
 */

export interface ScriptedTurn {
  spec: RunTurnSpec;
  settle(result?: Partial<TurnResult>): Promise<void>;
  /** Simulate the child session being acquired (runs the factory). */
  acquire(): Promise<void>;
  result: Promise<TurnResult>;
}

export function createScriptedRunner() {
  const turns: ScriptedTurn[] = [];
  const completedResult = (): TurnResult => ({
    status: "completed",
    text: "done",
    hasReply: true,
    error: null,
    stopReason: "end_turn",
    sessionId: "child-key",
    realSessionId: `child-${turns.length}`,
  });

  const runTurn = async (spec: RunTurnSpec, createSession: TurnSessionFactory): Promise<TurnResult> => {
    let resolveTurn: (result: TurnResult) => void = () => {};
    const result = new Promise<TurnResult>((resolve) => {
      resolveTurn = resolve;
    });
    const turn: ScriptedTurn = {
      spec,
      result,
      acquire: async () => {
        await createSession(spec.cwd, undefined, "subagent", { kind: "fresh" });
      },
      settle: async (overrides: Partial<TurnResult> = {}) => {
        resolveTurn({ ...completedResult(), ...overrides, realSessionId: `child-${turns.length}` });
        await result;
      },
    };
    turns.push(turn);
    return await result;
  };

  return { turns, runTurn };
}

export function fakeChildSession(realSessionId: string): SubagentChildSession {
  const manager = {
    appendSessionInfo: () => undefined,
    appendCustomEntry: () => undefined,
  };
  return {
    sessionId: realSessionId,
    inner: { sessionManager: manager },
    onEvent: () => () => {},
    onDestroy: () => () => {},
    send: async () => null,
    destroy: () => {},
  };
}

export function createChildSessionFactory() {
  const created: string[] = [];
  const factory = async (input: { taskId: string }) => {
    const realSessionId = `child-${input.taskId.slice(-6)}`;
    created.push(realSessionId);
    return { session: fakeChildSession(realSessionId), sessionId: realSessionId, realSessionId };
  };
  return { created, factory };
}

export interface ScheduledTimer {
  ms: number;
  cancelled: boolean;
  fire: () => void;
}

export function createFakeTimers() {
  const scheduled: ScheduledTimer[] = [];
  const timers: SubagentTaskTimers = {
    setTimeout: (callback, ms) => {
      const record: ScheduledTimer = { ms, cancelled: false, fire: callback };
      scheduled.push(record);
      return record;
    },
    clearTimeout: (handle) => {
      (handle as ScheduledTimer).cancelled = true;
    },
  };
  return { scheduled, timers };
}
