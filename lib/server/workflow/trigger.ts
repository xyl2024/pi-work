/**
 * Workflow trigger loop.
 *
 * A cyclic `setTimeout` (self-rescheduling, no drift) scans for cron
 * workflows whose `next_run_at` has arrived and fires them via the engine.
 * Manual triggers bypass this entirely — they create a run on demand.
 *
 * This is intentionally a *separate* loop from the scheduler's — workflows
 * and scheduled tasks are independent systems. Loop startup is wired in
 * workflow/startup.ts.
 */

import { Cron } from "croner";
import { getWorkflowDb } from "./db";
import { runWorkflow } from "./engine";
import { createLogger } from "../logger";

const log = createLogger("workflow/trigger");

let timer: ReturnType<typeof setTimeout> | null = null;

export function isWorkflowLoopRunning(): boolean {
  return timer !== null;
}

export function ensureWorkflowLoop(): void {
  if (timer !== null) return;
  log.info("workflow trigger loop starting");
  reconcileStaleWorkflows(Date.now());
  scheduleNext(0);
}

/** Advance cron workflows whose next_run_at has passed (missed triggers are
 *  skipped, not replayed — the cron expression is the source of truth). */
function reconcileStaleWorkflows(now: number): void {
  const rows = getWorkflowDb()
    .prepare(
      `SELECT id, cron, timezone FROM workflows
        WHERE enabled = 1 AND trigger_type = 'cron' AND next_run_at IS NOT NULL AND next_run_at < ?`,
    )
    .all(now) as Array<{ id: string; cron: string; timezone: string | null }>;
  for (const row of rows) advanceNextRun(row.id, row.cron, row.timezone ?? "UTC");
}

export function stopWorkflowLoop(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
    log.info("workflow trigger loop stopped");
  }
}

export function rescheduleWorkflowLoop(): void {
  if (timer === null) {
    ensureWorkflowLoop();
    return;
  }
  clearTimeout(timer);
  timer = null;
  scheduleNext(0);
}

function loadDue(now: number): Array<{ id: string; cron: string; timezone: string }> {
  const rows = getWorkflowDb()
    .prepare(
      `SELECT id, cron, timezone FROM workflows
        WHERE enabled = 1 AND trigger_type = 'cron' AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    )
    .all(now) as Array<{ id: string; cron: string; timezone: string | null }>;
  return rows.map((r) => ({ id: r.id, cron: r.cron, timezone: r.timezone ?? "UTC" }));
}

function loadNextWake(): number | null {
  const row = getWorkflowDb()
    .prepare(
      `SELECT MIN(next_run_at) AS next FROM workflows
        WHERE enabled = 1 AND trigger_type = 'cron' AND next_run_at IS NOT NULL`,
    )
    .get() as { next: number | null };
  return row.next;
}

function advanceNextRun(id: string, cron: string, timezone: string): void {
  try {
    const next = new Cron(cron, { timezone }).nextRun();
    getWorkflowDb().prepare("UPDATE workflows SET next_run_at = ? WHERE id = ?")
      .run(next ? next.getTime() : null, id);
  } catch (err) {
    log.warn("failed to advance next_run_at", { id, cron, timezone, error: String(err) });
  }
}

function scheduleNext(delayMs: number): void {
  if (timer !== null) return;
  const ms = Math.max(0, Math.floor(delayMs));
  timer = setTimeout(tick, ms);
  if (typeof timer.unref === "function") timer.unref();
}

async function tick(): Promise<void> {
  timer = null;
  const now = Date.now();
  const due = loadDue(now);
  if (due.length > 0) {
    log.info("firing cron workflows", { count: due.length });
    for (const wf of due) {
      advanceNextRun(wf.id, wf.cron, wf.timezone);
      void runWorkflow(wf.id, "cron", null);
    }
  }
  const nextWake = loadNextWake();
  if (nextWake === null) {
    log.debug("no cron workflows enabled; loop idle");
    return;
  }
  scheduleNext(Math.max(0, nextWake - Date.now()));
}