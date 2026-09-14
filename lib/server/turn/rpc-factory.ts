/**
 * Production wiring of the turn module: `runTurn` over a real pi RPC session.
 *
 * Kept in its own file so the orchestration core (`./orchestrate`) has no
 * import edge back into `rpc-manager`, and so this file can import both
 * statically without a cycle. The runtime knowledge lives here: a fresh
 * session per turn gets a unique registry key, mirroring the `__kanban__…` /
 * `__sched__…` temp-key pattern of the pre-seam runners.
 */
import { runTurn, type TurnResult } from "./orchestrate";
import { startRpcSession } from "../rpc-manager";
import type { ToolSelection } from "../../shared/types";

/** The audit sources `startRpcSession` accepts for a session. */
type RpcSessionSource = "scheduled" | "user" | "subagent";

/** Thinking levels accepted by the `set_thinking_level` RPC command. */
type RpcThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** What runTurnRpcSession accepts. Everything except cwd, prompt and timeout
 *  is genuinely optional — omitted model/thinking/tools simply send no setup
 *  command and defer to the session sidecar / cwd defaults. */
export type RunTurnRpcSpec = Omit<Parameters<typeof runTurn>[0], "source" | "toolNames" | "thinkingLevel"> & {
  source?: RpcSessionSource;
  toolNames?: ToolSelection;
  thinkingLevel?: RpcThinkingLevel;
};

/**
 * Run one complete turn in a freshly opened pi session: start the session in
 * `cwd`, apply the optional model/thinking level, deliver the prompt and wait
 * until the turn has really finished. No side effects — notifications, inbox
 * pushes, logs and channel state are the caller's job.
 */
export async function runTurnRpcSession(spec: RunTurnRpcSpec): Promise<TurnResult> {
  return await runTurn(
    {
      cwd: spec.cwd,
      prompt: spec.prompt,
      timeoutMs: spec.timeoutMs,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
      ...(spec.toolNames !== undefined ? { toolNames: spec.toolNames } : {}),
      ...(spec.source ? { source: spec.source } : {}),
    },
    // The turn module treats key-present-undefined exactly like absent, so the
    // conditional spreads above only keep `exactOptionalPropertyTypes`-style
    // intent explicit: a missing option is distinguishable from a set one.
    async (cwd, toolNames, source) => {
      // A fresh session per turn uses a unique registry key (the pre-seam
      // runners used `__kanban__…` / `__sched__…` temp keys).
      const tempKey = `__turn__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // "" as the session file means "create a new session" (startRpcSession).
      const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames, source as RpcSessionSource);
      return { session, sessionId: tempKey, realSessionId };
    },
  );
}
