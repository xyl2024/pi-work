/**
 * Executes one Kanban task as a background pi session.
 *
 * The run itself (open a session → apply model/thinking/tools → deliver the
 * prompt → wait until the turn has *really* finished → clean up) goes through
 * the turn module (`lib/server/turn`); this file is the board's adapter: it
 * owns the card vocabulary (review_test / result summary / run error) and the
 * per-task queue, and nothing else. `agent_settled` is the terminal event, so
 * a task that pi is still retrying (or compaction-retrying, or
 * continuation-running) stays `in_progress` instead of being reported as done
 * mid-flight.
 *
 * The store's status guard keeps runs race-free: the route flips the card to
 * in_progress via markRunStart before this file ever starts a session, and
 * both outcomes (success with a result summary; failure/abort with an `error`)
 * land the card in review_test for manual review.
 *
 * Concurrency: a per-task FIFO chain prevents the same task from ever running
 * twice in parallel; different tasks run independently (parallelism is the
 * whole point of a Kanban board).
 */

import { existsSync } from "fs";
import { runTurnRpcSession, type RunTurnRpcSpec } from "@/lib/server/rpc-manager";
import { runSerial } from "@/lib/server/serial-chain";
import { markRunEnd, setRunSessionId } from "./store";
import { CARD_TEXT_LIMIT, toCardRunEnd } from "./run-end";
import type { KanbanTask } from "@/lib/shared/kanban-types";

/** Safety net for a stuck agent that never reports back. Big enough that no
 *  real task should hit it, small enough that a runaway agent won't pin a
 *  process slot forever. Passed to the turn module as this caller's deadline. */
const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Per-task FIFO chain so two overlapping starts don't run concurrently. */
export function runTask(task: KanbanTask): Promise<void> {
  return runSerial(task.id, () => executeRun(task));
}

async function executeRun(task: KanbanTask): Promise<void> {
  // The route already flipped the task to in_progress via markRunStart, but
  // keep the cwd check here too so a stray run never half-executes.
  if (!existsSync(task.cwd)) {
    markRunEnd(task.id, {
      status: "review_test",
      error: `cwd missing: ${task.cwd}`,
    });
    return;
  }

  try {
    const result = await runTurnRpcSession({
      cwd: task.cwd,
      prompt: task.prompt,
      ...(task.provider && task.modelId
        ? { model: { provider: task.provider, modelId: task.modelId } }
        : {}),
      // The board historically sent the column value verbatim; the store only
      // validates that it is a string, so keep the pass-through.
      ...(task.thinkingLevel
        ? { thinkingLevel: task.thinkingLevel as RunTurnRpcSpec["thinkingLevel"] }
        : {}),
      // Today the board always states an explicit selection: a card's own
      // subset, or "all" when it has none. Never "unspecified".
      toolNames: task.toolNames ?? "all",
      source: "scheduled", // background run — attributed like other scheduled work
      timeoutMs: DEFAULT_MAX_LIFETIME_MS,
      // Record the real pi session id as soon as the session exists, so the
      // stop route can abort a run that is still in progress.
      onSession: ({ realSessionId }) => {
        setRunSessionId(task.id, realSessionId);
      },
    });

    markRunEnd(task.id, { status: "review_test", ...toCardRunEnd(result) });
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    markRunEnd(task.id, {
      status: "review_test",
      resultSummary: null,
      error: errorStr.slice(0, CARD_TEXT_LIMIT),
    });
  }
}
