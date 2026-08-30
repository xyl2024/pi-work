/**
 * CRUD on top of the workflow DB: workflows (+ their nodes) and run records.
 *
 * Mirrors `lib/server/scheduler/store.ts`: validation helpers + typed errors
 * + pure CRUD, all validation before any DB write. create/update mutate a
 * workflow's node set atomically (the UI submits the whole workflow with its
 * nodes in one payload).
 *
 * `next_run_at` is computed via croner whenever a cron workflow's cron /
 * enabled / timezone state changes, letting the trigger loop find the soonest
 * wake with a single index scan — exactly the scheduler's strategy.
 */

import { Cron } from "croner";
import { existsSync } from "fs";
import { assertNoCycle, autoLayeredLayout } from "./graph";
import { KINDS } from "@/lib/shared/workflow-nodes";
import { getWorkflowDb } from "./db";
import { sanitizeNotification } from "@/lib/server/notifications";
import { createLogger } from "../logger";
import type { TaskNotification } from "@/lib/shared/notifications";
import type {
  NodeCreateInput,
  Workflow,
  WorkflowCreateInput,
  WorkflowFailurePolicy,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunNode,
  WorkflowRunStatus,
  WorkflowTriggerInput,
  WorkflowTriggerType,
  WorkflowUpdateInput,
} from "@/lib/shared/workflow";

const log = createLogger("workflow-store");

const MAX_NAME_LENGTH = 200;
const MAX_DESC_LENGTH = 500;
const MAX_PROMPT_LENGTH = 50_000;
const MAX_CRON_LENGTH = 100;
const MAX_NODES = 50;
const DEFAULT_RUNS_LIMIT = 50;
const DEFAULT_TIMEZONE = "UTC";

const MIN_MAX_LIFETIME_MS = 1_000;
const MAX_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_MAX = 10;

export class WorkflowValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "WorkflowValidationError";
    this.field = field;
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(id: string) {
    super(`Workflow not found: ${id}`);
    this.name = "WorkflowNotFoundError";
  }
}

// ── Validators ───────────────────────────────────────────────────

function str(field: string, raw: unknown, required: boolean): string {
  if (typeof raw !== "string") {
    if (!required && (raw === undefined || raw === null)) return "";
    throw new WorkflowValidationError(field, `${field} must be a string`);
  }
  const v = raw.trim();
  if (!v) {
    if (required) throw new WorkflowValidationError(field, `${field} is required`);
    return v;
  }
  return v;
}

function optString(field: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new WorkflowValidationError(field, `${field} must be a string`);
  return raw.trim() || null;
}

function optBool(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  return !!raw;
}

function validateTriggerType(raw: unknown): WorkflowTriggerType {
  if (raw === "manual" || raw === "cron") return raw;
  throw new WorkflowValidationError("triggerType", 'triggerType must be "manual" or "cron"');
}

function validateCron(raw: unknown): string | null {
  const v = optString("cron", raw);
  if (v === null) return null;
  if (v.length > MAX_CRON_LENGTH) throw new WorkflowValidationError("cron", `cron must be ≤ ${MAX_CRON_LENGTH} chars`);
  try {
    new Cron(v);
  } catch (err) {
    throw new WorkflowValidationError("cron", `invalid cron expression: ${err instanceof Error ? err.message : String(err)}`);
  }
  return v;
}

function validateTimezone(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_TIMEZONE;
  if (typeof raw !== "string") throw new WorkflowValidationError("timezone", "timezone must be a string");
  const value = raw.trim();
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new WorkflowValidationError("timezone", "timezone must be a valid IANA timezone");
  }
}

function validateCwd(raw: unknown, required: boolean): string {
  const v = str("cwd", raw, required);
  if (!v) return v;
  if (!existsSync(v)) throw new WorkflowValidationError("cwd", `cwd does not exist: ${v}`);
  return v;
}

function validateMaxLifetimeMs(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new WorkflowValidationError("maxLifetimeMs", "maxLifetimeMs must be a number");
  if (!Number.isInteger(raw)) throw new WorkflowValidationError("maxLifetimeMs", "maxLifetimeMs must be an integer");
  if (raw < MIN_MAX_LIFETIME_MS) throw new WorkflowValidationError("maxLifetimeMs", `maxLifetimeMs must be ≥ ${MIN_MAX_LIFETIME_MS} (1 second)`);
  if (raw > MAX_MAX_LIFETIME_MS) throw new WorkflowValidationError("maxLifetimeMs", `maxLifetimeMs must be ≤ ${MAX_MAX_LIFETIME_MS} (24 hours)`);
  return raw;
}

function validateFailurePolicy(raw: unknown): WorkflowFailurePolicy {
  if (raw === "fail" || raw === "skip") return raw;
  throw new WorkflowValidationError("failurePolicy", 'failurePolicy must be "fail" or "skip"');
}

function validateMaxAttempts(raw: unknown): number {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new WorkflowValidationError("maxAttempts", "maxAttempts must be an integer ≥ 1");
  }
  if (raw > MAX_ATTEMPTS_MAX) throw new WorkflowValidationError("maxAttempts", `maxAttempts must be ≤ ${MAX_ATTEMPTS_MAX}`);
  return raw;
}

function validateKind(raw: unknown): WorkflowNode["kind"] {
  const k = typeof raw === "string" && raw ? raw : "agent";
  if ((KINDS as string[]).includes(k)) return k as WorkflowNode["kind"];
  throw new WorkflowValidationError("kind", `unknown node kind: ${k}`);
}

function validateParams(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorkflowValidationError("params", "params must be an object");
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === undefined) continue;
    // Must be JSON-serializable; reject functions / circular refs up front.
    try {
      JSON.stringify(val);
    } catch {
      throw new WorkflowValidationError("params", `param "${key}" is not JSON-serializable`);
    }
    out[key] = val;
  }
  return out;
}

function validateInputs(raw: unknown): WorkflowNode["inputs"] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WorkflowValidationError("inputs", "inputs must be an array");
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new WorkflowValidationError("inputs", `input ${i} must be an object`);
    const key = str("inputs", (item as { key?: unknown }).key, true);
    let ref: string | null = null;
    const r = (item as { ref?: unknown }).ref;
    if (typeof r === "string" && r.trim()) {
      const trimmed = r.trim();
      if (!/^[\w-]+\.[\w-]+$/.test(trimmed)) {
        throw new WorkflowValidationError("inputs", `input "${key}" ref must be "<nodeId>.<outputKey>"`);
      }
      ref = trimmed;
    }
    return { key, ref };
  });
}

function validateToolNames(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    if (!raw.every((t) => typeof t === "string")) throw new WorkflowValidationError("toolNames", "toolNames must be an array of strings");
    return raw as string[];
  }
  throw new WorkflowValidationError("toolNames", "toolNames must be an array or null");
}

function validateNotification(raw: unknown): TaskNotification | null {
  if (raw === null || raw === undefined) return null;
  try {
    return sanitizeNotification(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowValidationError("notification", message);
  }
}

interface NodeParts extends WorkflowNode {
  requestedId?: string;
  requestedDependsOn?: string[];
  hasCoords?: boolean;
}

/** Validate + finalize a workflow's node set from raw editor input.
 *
 *  The visual editor submits stable node `id`s together with explicit
 *  `dependsOn` DAG edges and `x`/`y` canvas coords. When any of those are
 *  omitted the store falls back to legacy behaviour: generated ids, an
 *  auto-chained dependency chain, and an automatic layered layout — so plain
 *  linear payloads still round-trip unchanged.
 *
 *  Post-validation steps: dedupe ids, resolve edges (rejecting self / unknown
 *  references), reject cycles, and auto-layout if any node lacks coordinates. */
function buildNodes(raw: unknown): WorkflowNode[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_NODES) throw new WorkflowValidationError("nodes", `a workflow can have at most ${MAX_NODES} nodes`);

  const now = Date.now();
  const built: NodeParts[] = raw.map((entry, position) => {
    if (typeof entry !== "object" || entry === null) {
      throw new WorkflowValidationError("nodes", "each node must be an object");
    }
    const n = entry as NodeCreateInput;
    const name = str("name", n.name, true);
    if (name.length > MAX_NAME_LENGTH) throw new WorkflowValidationError("name", `node name must be ≤ ${MAX_NAME_LENGTH} chars`);
    const kind = validateKind(n.kind);
    const prompt = str("prompt", n.prompt ?? "", kind === "agent");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new WorkflowValidationError("prompt", `prompt must be ≤ ${MAX_PROMPT_LENGTH} chars`);
    const cwdRaw = n.cwd;
    let cwd: string | null = null;
    if (cwdRaw !== undefined && cwdRaw !== null && cwdRaw !== "") {
      cwd = validateCwd(cwdRaw, true);
    }

    const requestedId = typeof n.id === "string" && n.id.trim() ? n.id.trim() : undefined;
    if (requestedId && requestedId.length > 100) {
      throw new WorkflowValidationError("id", "node id must be ≤ 100 chars");
    }

    let x = 0;
    let y = 0;
    if (typeof n.x === "number" && Number.isFinite(n.x)) x = Math.round(n.x);
    if (typeof n.y === "number" && Number.isFinite(n.y)) y = Math.round(n.y);
    const hasCoords = typeof n.x === "number" && typeof n.y === "number";

    let requestedDependsOn: string[] = [];
    if (n.dependsOn !== undefined && n.dependsOn !== null) {
      if (!Array.isArray(n.dependsOn) || !n.dependsOn.every((d) => typeof d === "string")) {
        throw new WorkflowValidationError("dependsOn", "dependsOn must be an array of node ids");
      }
      requestedDependsOn = [...new Set(n.dependsOn)];
    }

    return {
      id: "",
      workflowId: "",
      kind,
      name,
      prompt,
      cwd,
      provider: optString("provider", n.provider),
      modelId: optString("modelId", n.modelId),
      thinkingLevel: optString("thinkingLevel", n.thinkingLevel),
      toolNames: validateToolNames(n.toolNames),
      maxLifetimeMs: validateMaxLifetimeMs(n.maxLifetimeMs),
      params: validateParams(n.params),
      inputs: validateInputs(n.inputs),
      dependsOn: [],
      failurePolicy: validateFailurePolicy(n.failurePolicy),
      maxAttempts: validateMaxAttempts(n.maxAttempts),
      position,
      x,
      y,
      createdAt: now,
      updatedAt: now,
      requestedId,
      requestedDependsOn,
      hasCoords,
    };
  });

  // Assign stable, unique ids (prefer the client-provided ones).
  const used = new Set<string>();
  for (const b of built) {
    if (b.requestedId) {
      if (used.has(b.requestedId)) {
        throw new WorkflowValidationError("nodes", `duplicate node id: ${b.requestedId}`);
      }
      used.add(b.requestedId);
    }
  }
  for (const b of built) {
    if (b.requestedId) {
      b.id = b.requestedId;
    } else {
      let id = newId();
      while (used.has(id)) id = newId();
      used.add(id);
      b.id = id;
    }
    delete b.requestedId;
  }

  // Resolve DAG edges and reject self / unknown references.
  const idSet = new Set(built.map((b) => b.id));
  for (const b of built) {
    const deps = (b.requestedDependsOn ?? []).filter((d) => d !== b.id);
    for (const d of deps) {
      if (!idSet.has(d)) {
        throw new WorkflowValidationError("dependsOn", `node "${b.name}" depends on unknown node "${d}"`);
      }
    }
    b.dependsOn = deps;
    delete b.requestedDependsOn;
  }

  assertNoCycleWF(built);

  // If any node lacks coordinates, lay the whole graph out automatically so
  // legacy / linear payloads never end up stacked at the origin.
  if (!built.every((b) => b.hasCoords)) {
    autoLayeredLayout(built);
  }
  for (const b of built) delete b.hasCoords;

  return built;
}

/** Throw if the dependsOn edge set contains a cycle (would stall execution). */
function assertNoCycleWF(nodes: WorkflowNode[]): void {
  try {
    assertNoCycle(nodes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowValidationError("dependsOn", message);
  }
}

function computeNextRun(cron: string | null, enabled: boolean, timezone: string): number | null {
  if (!enabled || !cron) return null;
  try {
    const next = new Cron(cron, { timezone }).nextRun();
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ── Row mapping ─────────────────────────────────────────────────

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [] as T[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : ([] as T[]);
  } catch {
    return [] as T[];
  }
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseToolNames(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function parseTriggerInput(raw: string | null): WorkflowTriggerInput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkflowTriggerInput;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseNotification(raw: string | null): TaskNotification | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TaskNotification;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

interface NodeRow {
  id: string;
  workflow_id: string;
  kind: string;
  name: string;
  prompt: string;
  cwd: string | null;
  provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  tool_names: string | null;
  max_lifetime_ms: number | null;
  params: string;
  inputs: string;
  depends_on: string;
  failure_policy: string;
  max_attempts: number;
  position: number;
  x: number;
  y: number;
  created_at: number;
  updated_at: number;
}

function rowToNode(row: NodeRow): WorkflowNode {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    kind: (KINDS as string[]).includes(row.kind) ? row.kind as WorkflowNode["kind"] : "agent",
    name: row.name,
    prompt: row.prompt,
    cwd: row.cwd,
    provider: row.provider,
    modelId: row.model_id,
    thinkingLevel: row.thinking_level,
    toolNames: parseToolNames(row.tool_names),
    maxLifetimeMs: row.max_lifetime_ms,
    params: parseRecord(row.params),
    inputs: parseJsonArray<WorkflowNode["inputs"][number]>(row.inputs),
    dependsOn: parseJsonArray<string>(row.depends_on),
    failurePolicy: (row.failure_policy === "skip" || row.failure_policy === "fail" ? row.failure_policy : "fail") as WorkflowFailurePolicy,
    maxAttempts: row.max_attempts,
    position: row.position,
    x: row.x ?? 0,
    y: row.y ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WfRow {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  cron: string | null;
  timezone: string | null;
  enabled: number;
  cwd: string;
  notification: string | null;
  created_at: number;
  updated_at: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_status: WorkflowRunStatus | null;
}

const WF_BASE_QUERY = `
  SELECT w.*, (
    SELECT r.status FROM workflow_runs r
    WHERE r.workflow_id = w.id
    ORDER BY r.started_at DESC LIMIT 1
  ) AS last_run_status
  FROM workflows w
`;

function rowToWorkflow(row: WfRow, nodes: WorkflowNode[]): Workflow {
  const timezone = row.timezone ?? DEFAULT_TIMEZONE;
  let nextRunAt = row.next_run_at;
  // Recompute a stale next_run_at (e.g. we were down across a trigger).
  if (row.enabled === 1 && nextRunAt !== null && nextRunAt < Date.now()) {
    nextRunAt = computeNextRun(row.cron, true, timezone);
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: (row.trigger_type === "cron" ? "cron" : "manual") as WorkflowTriggerType,
    cron: row.cron,
    timezone,
    enabled: row.enabled === 1,
    cwd: row.cwd,
    notification: parseNotification(row.notification),
    nodes: [...nodes].sort((a, b) => a.position - b.position),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
  };
}

function getNodes(workflowId: string): WorkflowNode[] {
  const rows = getWorkflowDb()
    .prepare("SELECT * FROM workflow_nodes WHERE workflow_id = ? ORDER BY position ASC")
    .all(workflowId) as NodeRow[];
  return rows.map(rowToNode);
}

// ── Workflow CRUD ───────────────────────────────────────────────

export function listWorkflows(): Workflow[] {
  const rows = getWorkflowDb().prepare(`${WF_BASE_QUERY} ORDER BY w.created_at DESC`).all() as WfRow[];
  return rows.map((row) => rowToWorkflow(row, getNodes(row.id)));
}

export function getWorkflow(id: string): Workflow | null {
  const row = getWorkflowDb().prepare(`${WF_BASE_QUERY} WHERE w.id = ?`).get(id) as WfRow | undefined;
  if (!row) return null;
  return rowToWorkflow(row, getNodes(id));
}

export function createWorkflow(input: WorkflowCreateInput): Workflow {
  const name = str("name", input.name, true);
  if (name.length > MAX_NAME_LENGTH) throw new WorkflowValidationError("name", `name must be ≤ ${MAX_NAME_LENGTH} chars`);
  const description = str("description", input.description, false);
  if (description.length > MAX_DESC_LENGTH) throw new WorkflowValidationError("description", `description must be ≤ ${MAX_DESC_LENGTH} chars`);
  const triggerType = validateTriggerType(input.triggerType);
  const cron = triggerType === "cron" ? validateCron(input.cron) : null;
  const timezone = validateTimezone(input.timezone);
  const enabled = triggerType === "cron" ? (optBool(input.enabled) ?? true) : true;
  const cwd = validateCwd(input.cwd, true);
  const notification = validateNotification(input.notification);
  const nodes = buildNodes(input.nodes);

  const now = Date.now();
  const id = newId();
  const nextRunAt = computeNextRun(cron, enabled, timezone);

  const db = getWorkflowDb();
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO workflows (id, name, description, trigger_type, cron, timezone, enabled,
         cwd, notification, created_at, updated_at, next_run_at, last_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(id, name, description, triggerType, cron, timezone, enabled ? 1 : 0, cwd,
      notification ? JSON.stringify(notification) : null, now, now, nextRunAt);
    insertNodes(db, id, nodes, now);
  });
  insert();

  log.info("workflow created", { id, name, triggerType, nodeCount: nodes.length });
  return getWorkflow(id)!;
}

function insertNodes(db: ReturnType<typeof getWorkflowDb>, workflowId: string, nodes: WorkflowNode[], now: number): void {
  const stmt = db.prepare(
    `INSERT INTO workflow_nodes (id, workflow_id, kind, name, prompt, cwd, provider, model_id,
       thinking_level, tool_names, max_lifetime_ms, params, inputs, depends_on, failure_policy,
       max_attempts, position, x, y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const n of nodes) {
    stmt.run(n.id, workflowId, n.kind, n.name, n.prompt, n.cwd, n.provider, n.modelId, n.thinkingLevel,
      n.toolNames ? JSON.stringify(n.toolNames) : null, n.maxLifetimeMs,
      JSON.stringify(n.params ?? {}), JSON.stringify(n.inputs ?? []),
      JSON.stringify(n.dependsOn), n.failurePolicy, n.maxAttempts, n.position, n.x, n.y, now, now);
  }
}

export function updateWorkflow(input: WorkflowUpdateInput): Workflow {
  const existing = getWorkflow(input.id);
  if (!existing) throw new WorkflowNotFoundError(input.id);

  const patch: Partial<WorkflowCreateInput> = {};
  if (input.name !== undefined) {
    const name = str("name", input.name, true);
    if (name.length > MAX_NAME_LENGTH) throw new WorkflowValidationError("name", `name must be ≤ ${MAX_NAME_LENGTH} chars`);
    patch.name = name;
  }
  if (input.description !== undefined) {
    const description = str("description", input.description, false);
    if (description.length > MAX_DESC_LENGTH) throw new WorkflowValidationError("description", `description must be ≤ ${MAX_DESC_LENGTH} chars`);
    patch.description = description;
  }
  if (input.triggerType !== undefined) patch.triggerType = validateTriggerType(input.triggerType);
  if (input.cron !== undefined) patch.cron = validateCron(input.cron);
  if (input.timezone !== undefined) patch.timezone = validateTimezone(input.timezone);
  if (input.enabled !== undefined) patch.enabled = !!input.enabled;
  if (input.cwd !== undefined) patch.cwd = validateCwd(input.cwd, true);
  if (input.notification !== undefined) patch.notification = validateNotification(input.notification);
  if (input.triggerType === "manual") patch.cron = null;

  const merged: Workflow = { ...existing, ...patch } as Workflow;
  // Keep cron/timezone/env consistent with the merged trigger type.
  const triggerType: WorkflowTriggerType = merged.triggerType;
  const cron = triggerType === "cron" ? merged.cron : null;
  const enabled = triggerType === "cron" ? merged.enabled : true;

  let nodes = existing.nodes;
  if (Array.isArray(input.nodes)) {
    nodes = buildNodes(input.nodes);
  }

  const now = Date.now();
  const nextRunAt = computeNextRun(cron, enabled, merged.timezone);
  const db = getWorkflowDb();
  const update = db.transaction(() => {
    db.prepare(
      `UPDATE workflows SET name = ?, description = ?, trigger_type = ?, cron = ?, timezone = ?,
         enabled = ?, cwd = ?, notification = ?, updated_at = ?, next_run_at = ?
       WHERE id = ?`
    ).run(merged.name, merged.description, triggerType, cron, merged.timezone, enabled ? 1 : 0,
      merged.cwd, merged.notification ? JSON.stringify(merged.notification) : null, now, nextRunAt, input.id);
    db.prepare("DELETE FROM workflow_nodes WHERE workflow_id = ?").run(input.id);
    insertNodes(db, input.id, nodes, now);
  });
  update();

  log.info("workflow updated", { id: input.id, nodeCount: nodes.length });
  return getWorkflow(input.id)!;
}

export function deleteWorkflow(id: string): void {
  const db = getWorkflowDb();
  // workflow_nodes / workflow_runs cascade via FK.
  const res = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  if (res.changes === 0) throw new WorkflowNotFoundError(id);
  log.info("workflow deleted", { id });
}

export function setWorkflowEnabled(id: string, enabled: boolean): Workflow {
  return updateWorkflow({ id, enabled });
}

// ── Run records ─────────────────────────────────────────────────

export function listWorkflowRuns(workflowId: string, limit = DEFAULT_RUNS_LIMIT): WorkflowRun[] {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = getWorkflowDb()
    .prepare(
      `SELECT id, workflow_id, trigger, trigger_input, status, error, reply_text, started_at, ended_at
         FROM workflow_runs WHERE workflow_id = ?
         ORDER BY started_at DESC LIMIT ?`
    )
    .all(workflowId, safeLimit) as Array<{
      id: string; workflow_id: string; trigger: string; trigger_input: string | null;
      status: string; error: string | null; reply_text: string | null; started_at: number; ended_at: number | null;
    }>;
  return rows.map(rowToRun);
}

function rowToRun(row: {
  id: string; workflow_id: string; trigger: string; trigger_input: string | null;
  status: string; error: string | null; reply_text: string | null; started_at: number; ended_at: number | null;
}): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    trigger: row.trigger === "cron" ? "cron" : "manual",
    triggerInput: parseTriggerInput(row.trigger_input),
    status: row.status as WorkflowRunStatus,
    error: row.error,
    replyText: row.reply_text,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function getWorkflowRun(runId: string): WorkflowRun | null {
  const row = getWorkflowDb()
    .prepare(
      `SELECT id, workflow_id, trigger, trigger_input, status, error, reply_text, started_at, ended_at
         FROM workflow_runs WHERE id = ?`
    )
    .get(runId) as
    | { id: string; workflow_id: string; trigger: string; trigger_input: string | null; status: string; error: string | null; reply_text: string | null; started_at: number; ended_at: number | null }
    | undefined;
  if (!row) return null;
  return rowToRun(row);
}

/** current run + its per-node progress. */
export function getWorkflowRunWithNodes(runId: string): { run: WorkflowRun; nodes: WorkflowRunNode[] } | null {
  const run = getWorkflowRun(runId);
  if (!run) return null;
  return { run, nodes: listRunNodes(runId) };
}

export function listRunNodes(runId: string): WorkflowRunNode[] {
  const rows = getWorkflowDb()
    .prepare(
      `SELECT id, run_id, node_id, status, attempts, render_input, reply_text, error, session_id, started_at, ended_at, duration_ms
         FROM workflow_run_nodes WHERE run_id = ?
         ORDER BY started_at ASC`
    )
    .all(runId) as Array<{
      id: string; run_id: string; node_id: string; status: string; attempts: number;
      render_input: string | null; reply_text: string | null; error: string | null; session_id: string | null;
      started_at: number | null; ended_at: number | null; duration_ms: number | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    status: r.status as WorkflowRunNode["status"],
    attempts: r.attempts,
    renderInput: r.render_input,
    replyText: r.reply_text,
    error: r.error,
    sessionId: r.session_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
  }));
}

export function getRunNode(runNodeId: string): WorkflowRunNode | null {
  const row = getWorkflowDb()
    .prepare(
      `SELECT id, run_id, node_id, status, attempts, render_input, reply_text, error, session_id, started_at, ended_at, duration_ms
         FROM workflow_run_nodes WHERE id = ?`
    )
    .get(runNodeId) as
    | { id: string; run_id: string; node_id: string; status: string; attempts: number; render_input: string | null; reply_text: string | null; error: string | null; session_id: string | null; started_at: number | null; ended_at: number | null; duration_ms: number | null }
    | undefined;
  if (!row) return null;
  return listRunNodes(row.run_id).find((n) => n.id === runNodeId) ?? null;
}

// ── Run lifecycle ───────────────────────────────────────────────

export function createWorkflowRun(workflowId: string, trigger: "manual" | "cron", triggerInput: WorkflowTriggerInput | null): WorkflowRun {
  const id = newId();
  const startedAt = Date.now();
  getWorkflowDb()
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_id, trigger, trigger_input, status, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)`
    )
    .run(id, workflowId, trigger, triggerInput ? JSON.stringify(triggerInput) : null, startedAt);

  // Snapshot the workflow's nodes into the run so later edits to the workflow
  // don't rewrite in-flight runs — each run is a frozen copy of its nodes.
  const wf = getWorkflow(workflowId);
  if (wf) {
    const stmt = getWorkflowDb().prepare(
      `INSERT INTO workflow_run_nodes (id, run_id, node_id, status, attempts)
       VALUES (?, ?, ?, 'pending', 0)`
    );
    const nodeIds = new Map<string, string>();
    // Re-key: create our own run-node ids but keep original node ids so the
    // engine can map prompt endpoints etc.
    for (const n of [...wf.nodes].sort((a, b) => a.position - b.position)) {
      const runNodeId = newId();
      nodeIds.set(n.id, runNodeId);
      stmt.run(runNodeId, id, n.id);
    }
    // node_id column stores the workflow node id (kept for mapping); the row
    // id is the run-node identity. Fine for Phase 1 chains.
  }

  log.info("workflow run created", { runId: id, workflowId, trigger });
  return getWorkflowRun(id)!;
}

export interface RecordRunEndInput {
  status: WorkflowRunStatus;
  error?: string | null;
  replyText?: string | null;
}

export function updateWorkflowRun(runId: string, input: Partial<{ status: WorkflowRunStatus; error: string | null; replyText: string | null }>): WorkflowRun {
  const existing = getWorkflowRun(runId);
  if (!existing) throw new WorkflowNotFoundError(runId);
  const db = getWorkflowDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.error !== undefined) { fields.push("error = ?"); values.push(input.error); }
  if (input.replyText !== undefined) { fields.push("reply_text = ?"); values.push(input.replyText); }
  if (input.status !== undefined && (input.status === "success" || input.status === "failed" || input.status === "canceled" || input.status === "interrupted")) {
    fields.push("ended_at = ?");
    values.push(Date.now());
  }
  const reply = fields.length
    ? db.prepare(`UPDATE workflow_runs SET ${fields.join(", ")} WHERE id = ?`)
    : null;
  if (reply) reply.run(...values, runId);
  db.prepare("UPDATE workflows SET last_run_at = ?, last_run_status = ? WHERE id = ?")
    .run(Date.now(), input.status ?? existing.status, existing.workflowId);
  return getWorkflowRun(runId)!;
}

export function setRunNodeStatus(runNodeId: string, patch: Partial<{
  status: WorkflowRunNode["status"];
  renderInput: string | null;
  replyText: string | null;
  error: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number;
}>): WorkflowRunNode {
  const existing = getRunNode(runNodeId);
  if (!existing) throw new WorkflowNotFoundError(runNodeId);
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.status !== undefined) { fields.push("status = ?"); values.push(patch.status); }
  if (patch.renderInput !== undefined) { fields.push("render_input = ?"); values.push(patch.renderInput); }
  if (patch.replyText !== undefined) { fields.push("reply_text = ?"); values.push(patch.replyText); }
  if (patch.error !== undefined) { fields.push("error = ?"); values.push(patch.error); }
  if (patch.sessionId !== undefined) { fields.push("session_id = ?"); values.push(patch.sessionId); }
  if (patch.startedAt !== undefined) { fields.push("started_at = ?"); values.push(patch.startedAt); }
  if (patch.endedAt !== undefined) { fields.push("ended_at = ?"); values.push(patch.endedAt); }
  if (patch.endedAt !== undefined && patch.status && patch.status !== "running") {
    const durationMs = patch.endedAt - (existing.startedAt ?? patch.endedAt);
    fields.push("duration_ms = ?");
    values.push(durationMs);
  }
  if (fields.length === 0) return existing;
  getWorkflowDb().prepare(`UPDATE workflow_run_nodes SET ${fields.join(", ")} WHERE id = ?`).run(...values, runNodeId);
  return listRunNodes(existing.runId).find((n) => n.id === runNodeId)!;
}

export function incrementRunNodeAttempts(runNodeId: string): WorkflowRunNode {
  const existing = getRunNode(runNodeId);
  if (!existing) throw new WorkflowNotFoundError(runNodeId);
  getWorkflowDb().prepare("UPDATE workflow_run_nodes SET attempts = attempts + 1 WHERE id = ?").run(runNodeId);
  return listRunNodes(existing.runId).find((n) => n.id === runNodeId)!;
}

/** In-flight runs (and their running nodes) for restart reconciliation. */
export function listRunningWorkflowRuns(): Array<{ runId: string; workflowId: string; startedAt: number }> {
  const rows = getWorkflowDb()
    .prepare("SELECT id, workflow_id, started_at FROM workflow_runs WHERE status = 'running'")
    .all() as Array<{ id: string; workflow_id: string; started_at: number }>;
  return rows.map((r) => ({ runId: r.id, workflowId: r.workflow_id, startedAt: r.started_at }));
}