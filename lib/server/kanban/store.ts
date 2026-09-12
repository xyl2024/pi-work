/**
 * CRUD + status transitions for Kanban tasks, backed by kanban_tasks.
 *
 * Row mapping and light validation live here; the runner (runner.ts) drives
 * the `in_progress -> review_test` lifecycle via markRunStart / markRunEnd.
 * Status transitions:
 *   backlog      --createTask--> backlog
 *   backlog      --markRunStart--> in_progress
 *   in_progress  --markRunEnd-->   review_test (success OR error)
 *   review_test  --updateTask-->   done        (manual move / drag)
 *   anywhere     --updateTask-->   any status  (manual drag correction)
 */

import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { getKanbanDb } from "./db";
import { getRpcSession } from "@/lib/server/session-registry";
import type {
  CreateKanbanTaskInput,
  KanbanStatus,
  KanbanTask,
  UpdateKanbanTaskInput,
} from "@/lib/shared/kanban-types";

interface TaskRow {
  id: string;
  task_name: string | null;
  prompt: string;
  provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  cwd: string;
  tool_names: string | null;
  status: string;
  error: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  session_id: string | null;
  result_summary: string | null;
  sort_order: number;
}

export class KanbanValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "KanbanValidationError";
  }
}

export class KanbanNotFoundError extends Error {
  constructor() {
    super("kanban task not found");
    this.name = "KanbanNotFoundError";
  }
}

export class KanbanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KanbanConflictError";
  }
}

function parseToolNames(raw: string | null): string[] | "all" | null {
  if (raw === null) return null;
  if (raw === "all") return "all";
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function mapRow(r: TaskRow): KanbanTask {
  return {
    id: r.id,
    taskName: r.task_name ?? "",
    prompt: r.prompt,
    provider: r.provider,
    modelId: r.model_id,
    thinkingLevel: r.thinking_level,
    cwd: r.cwd,
    toolNames: parseToolNames(r.tool_names),
    status: r.status as KanbanStatus,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    sessionId: r.session_id,
    resultSummary: r.result_summary,
    sortOrder: r.sort_order,
    stats: null,
  };
}

/** A short, human-readable name for a card. Uses the user-provided task name,
 *  or derives one from the first non-empty line of the prompt (≤60 chars). */
function resolveTaskName(rawName: string | null | undefined, prompt: string): string {
  const explicit = rawName?.trim();
  if (explicit) return explicit.slice(0, 120);
  const firstLine = prompt
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine ?? prompt.trim()).slice(0, 60);
}

function validatePrompt(prompt: unknown): asserts prompt is string {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new KanbanValidationError("prompt", "prompt is required");
  }
}

function validateCwd(cwd: unknown): asserts cwd is string {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new KanbanValidationError("cwd", "cwd is required");
  }
  if (!existsSync(cwd)) {
    throw new KanbanValidationError("cwd", "cwd does not exist");
  }
}

function validateThinkingLevel(level: unknown): void {
  if (level === null || level === undefined) return;
  if (typeof level !== "string") {
    throw new KanbanValidationError("thinkingLevel", "thinkingLevel must be a string");
  }
}

function validateToolNames(toolNames: unknown): void {
  if (toolNames === null || toolNames === undefined) return;
  if (toolNames === "all") return;
  if (
    Array.isArray(toolNames) &&
    toolNames.every((x) => typeof x === "string")
  ) {
    return;
  }
  throw new KanbanValidationError("toolNames", "toolNames must be \"all\", null, or an array of strings");
}

const listStmt = `
  SELECT * FROM kanban_tasks ORDER BY
    CASE status
      WHEN 'backlog' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'review_test' THEN 2
      ELSE 3
    END,
    sort_order ASC, created_at ASC
`;

export function listTasks(): KanbanTask[] {
  const db = getKanbanDb();
  return (db.prepare(listStmt).all() as TaskRow[]).map(mapRow);
}

export function getTask(id: string): KanbanTask | null {
  const db = getKanbanDb();
  const row = db.prepare("SELECT * FROM kanban_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createTask(input: CreateKanbanTaskInput): KanbanTask {
  validatePrompt(input.prompt);
  validateCwd(input.cwd);
  validateThinkingLevel(input.thinkingLevel);
  validateToolNames(input.toolNames);

  const db = getKanbanDb();
  const id = randomUUID();
  const now = Date.now();
  const maxSort = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM kanban_tasks WHERE status = 'backlog'")
    .get() as { m: number };

  db.prepare(
    `INSERT INTO kanban_tasks
      (id, task_name, prompt, provider, model_id, thinking_level, cwd, tool_names, status, error,
       created_at, started_at, ended_at, session_id, result_summary, sort_order)
     VALUES (@id, @taskName, @prompt, @provider, @modelId, @thinkingLevel, @cwd, @toolNames, 'backlog', NULL,
       @createdAt, NULL, NULL, NULL, NULL, @sortOrder)`,
  ).run({
    id,
    taskName: resolveTaskName(input.taskName, input.prompt),
    prompt: input.prompt.trim(),
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    thinkingLevel: input.thinkingLevel ?? null,
    cwd: input.cwd,
    toolNames: input.toolNames == null ? null
      : input.toolNames === "all" ? "all"
      : JSON.stringify(input.toolNames),
    createdAt: now,
    sortOrder: maxSort.m + 1,
  });

  return getTask(id)!;
}

export function updateTask(id: string, patch: UpdateKanbanTaskInput): KanbanTask {
  const existing = getTask(id);
  if (!existing) throw new KanbanNotFoundError();

  if (patch.prompt !== undefined) validatePrompt(patch.prompt);
  if (patch.cwd !== undefined) validateCwd(patch.cwd);
  if (patch.thinkingLevel !== undefined) validateThinkingLevel(patch.thinkingLevel);
  if (patch.toolNames !== undefined) validateToolNames(patch.toolNames);
  if (patch.status !== undefined) {
    const valid: KanbanStatus[] = ["backlog", "in_progress", "review_test", "done"];
    if (!valid.includes(patch.status)) {
      throw new KanbanValidationError("status", "invalid status");
    }
  }

  const db = getKanbanDb();
  db.prepare(
    `UPDATE kanban_tasks SET
       task_name = CASE WHEN @hasName THEN @taskName ELSE task_name END,
       prompt = COALESCE(@prompt, prompt),
       provider = CASE WHEN @hasProvider THEN @provider ELSE provider END,
       model_id = CASE WHEN @hasModel THEN @modelId ELSE model_id END,
       thinking_level = CASE WHEN @hasThinking THEN @thinkingLevel ELSE thinking_level END,
       cwd = COALESCE(@cwd, cwd),
       tool_names = CASE WHEN @hasTools THEN @toolNames ELSE tool_names END,
       status = COALESCE(@status, status),
       sort_order = CASE WHEN @hasSort THEN @sortOrder ELSE sort_order END,
       error = CASE WHEN @status IS NOT NULL THEN NULL ELSE error END
     WHERE id = @id`,
  ).run({
    id,
    taskName: patch.taskName !== undefined ? resolveTaskName(patch.taskName, existing.prompt) : null,
    hasName: patch.taskName !== undefined ? 1 : 0,
    prompt: patch.prompt?.trim() ?? null,
    provider: patch.provider ?? null,
    hasProvider: patch.provider !== undefined ? 1 : 0,
    modelId: patch.modelId ?? null,
    hasModel: patch.modelId !== undefined ? 1 : 0,
    thinkingLevel: patch.thinkingLevel ?? null,
    hasThinking: patch.thinkingLevel !== undefined ? 1 : 0,
    cwd: patch.cwd ?? null,
    toolNames:
      patch.toolNames === undefined ? null
        : patch.toolNames === null ? null
        : patch.toolNames === "all" ? "all"
        : JSON.stringify(patch.toolNames),
    hasTools: patch.toolNames !== undefined ? 1 : 0,
    status: patch.status ?? null,
    sortOrder: patch.sortOrder ?? 0,
    hasSort: patch.sortOrder !== undefined ? 1 : 0,
  });

  return getTask(id)!;
}

export function deleteTask(id: string): void {
  const db = getKanbanDb();
  db.prepare("DELETE FROM kanban_tasks WHERE id = ?").run(id);
}

/** Transition a task into an executing run. Only a `backlog` (idle) task may
 *  start; anything else (already in_progress, review_test, done) is a
 *  conflict so we can't double-fire one task. */
export function markRunStart(id: string, sessionId: string): KanbanTask {
  const existing = getTask(id);
  if (!existing) throw new KanbanNotFoundError();
  if (existing.status !== "backlog") {
    throw new KanbanConflictError("task is not in backlog");
  }
  const db = getKanbanDb();
  db.prepare(
    `UPDATE kanban_tasks SET status = 'in_progress', session_id = @sessionId,
       started_at = @now, error = NULL, result_summary = NULL WHERE id = @id`,
  ).run({ id, sessionId, now: Date.now() });
  return getTask(id)!;
}

/** Idempotently record the real pi session id on the run row (no status
 *  change / no backlog guard — the route already moved the task into
 *  in_progress, this just fills in the id the runner just created). */
export function setRunSessionId(id: string, sessionId: string): KanbanTask {
  const existing = getTask(id);
  if (!existing) throw new KanbanNotFoundError();
  const db = getKanbanDb();
  db.prepare("UPDATE kanban_tasks SET session_id = @sessionId WHERE id = @id").run({
    id,
    sessionId,
  });
  return getTask(id)!;
}

/** The run for a task finished (success via resultSummary, or error). Both
 *  outcomes land in review_test so the user reviews what the agent actually
 *  did before closing it out. */
export function markRunEnd(
  id: string,
  input: { status?: KanbanStatus; resultSummary?: string | null; error?: string | null },
): KanbanTask {
  const existing = getTask(id);
  if (!existing) throw new KanbanNotFoundError();
  const db = getKanbanDb();
  db.prepare(
    `UPDATE kanban_tasks SET status = @status, error = @error,
       result_summary = @resultSummary, ended_at = @now WHERE id = @id`,
  ).run({
    id,
    status: input.status ?? "review_test",
    error: input.error ?? null,
    resultSummary: input.resultSummary ?? null,
    now: Date.now(),
  });
  return getTask(id)!;
}

/**
 * Reverse-sync: revive a terminal card (review_test / done) whose pi session
 * the user has started continuing. The card goes back to `in_progress` with a
 * fresh `started_at`; when that conversation's run ends the resume watcher
 * (lib/server/kanban/session-sync.ts) writes the new output back via
 * markRunEnd. The session_id is left untouched — it already points at the
 * session being continued.
 *
 * Only a card whose session_id matches AND status is a terminal one is
 * resumed. A backlog (never ran) or already-in_progress card is left alone.
 * Returns the resumed task, or null if there is nothing to resume.
 */
export function resumeTaskForSession(sessionId: string): KanbanTask | null {
  const db = getKanbanDb();
  const row = db
    .prepare(
      `SELECT * FROM kanban_tasks
        WHERE session_id = @sid AND status IN ('review_test', 'done')
        ORDER BY ended_at DESC LIMIT 1`,
    )
    .get({ sid: sessionId }) as TaskRow | undefined;
  if (!row) return null;
  db.prepare(
    `UPDATE kanban_tasks SET status = 'in_progress', error = NULL,
       result_summary = NULL, started_at = @now, ended_at = NULL WHERE id = @id`,
  ).run({ id: row.id, now: Date.now() });
  return getTask(row.id)!;
}

/** Stats for the top status bar — all counts are global (across cwds). */
export function getKanbanStats(): {
  inProgress: number;
  reviewTest: number;
  total: number;
} {
  const db = getKanbanDb();
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM kanban_tasks GROUP BY status`,
    )
    .all() as Array<{ status: string; n: number }>;
  let inProgress = 0;
  let reviewTest = 0;
  let total = 0;
  for (const r of rows) {
    total += r.n;
    if (r.status === "in_progress") inProgress = r.n;
    else if (r.status === "review_test") reviewTest = r.n;
  }
  return { inProgress, reviewTest, total };
}

/**
 * Grace window for a freshly-reserved run. The run route flips a Backlog card
 * to `in_progress` (with an EMPTY session id) before the runner cold-starts the
 * pi session and writes the real id. Live reconcile calls within this window
 * must not kill that in-flight reservation.
 */
const STALE_GRACE_MS = 30_000;

/**
 * Detect "zombie" in_progress cards: a task whose status is `in_progress` but
 * whose pi session is no longer alive (process crash / restart, or the run was
 * reserved and the session never started). Leftover runs like this can never
 * deliver agent_end, so we move them to review_test with an explanatory error
 * (the product decision: interrupted/aborted runs land in Review & Test for the
 * user to inspect).
 *
 *  - `immediate` (startup): no grace — at boot there is no in-flight reserve,
 *    so every in_progress card without a live wrapper is interrupted at once.
 *  - live calls (board load): a grace window protects the reserve -> set-session
 *    window from being falsely killed.
 *
 * Returns the number of cards reconciled.
 */
export function reconcileStaleTasks(now = Date.now(), immediate = false): {
  count: number;
} {
  const db = getKanbanDb();
  const rows = db
    .prepare("SELECT * FROM kanban_tasks WHERE status = 'in_progress'")
    .all() as TaskRow[];
  let count = 0;
  for (const row of rows) {
    const startAge = now - (row.started_at ?? now);
    let running = false;
    if (row.session_id) {
      const wrapper = getRpcSession(row.session_id);
      running = !!wrapper && wrapper.isAlive() === true;
    }
    if (running) continue;
    if (!immediate && startAge <= STALE_GRACE_MS) continue;

    const reason = row.session_id
      ? "kanban session is no longer alive (interrupted)"
      : "kanban run was interrupted before its session started";
    db.prepare(
      `UPDATE kanban_tasks SET status = 'review_test', error = @e,
         ended_at = @now WHERE id = @id`,
    ).run({ e: reason, now, id: row.id });
    count++;
  }
  return { count };
}