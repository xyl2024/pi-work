/**
 * Workflow engine shared wire types.
 *
 * Server persistence lives in `lib/server/workflow/` (imports better-sqlite3 /
 * croner and must not cross into the browser bundle). These plain interfaces
 * are the single source of truth for the wire format shared by the API
 * responses and the client workflow UI — mirror-free, so a renamed column
 * fails type-check rather than drifting silently like a hand-mirrored set.
 */

import type { TaskNotification } from "./notifications";

/** How a workflow is scheduled. `cron` workflows ALSO remain manually
 *  triggerable; `manual` workflows only run when explicitly fired. */
export type WorkflowTriggerType = "manual" | "cron";

export type WorkflowRunStatus =
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "interrupted";

export type WorkflowNodeRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "interrupted";

/** Node failure handling once retries are exhausted. `fail` aborts the whole
 *  run; `skip` marks only this node skipped and lets the chain continue. */
export type WorkflowFailurePolicy = "fail" | "skip";

/** A node type selectable in the visual orchestration editor. `agent` runs a
 *  pi session; the rest are pure functions (kind registry + compute live in
 *  lib/shared/workflow-nodes.ts). */
export type WorkflowNodeKind =
  | "start"
  | "agent"
  | "string"
  | "json"
  | "end";

export type WorkflowValueType = "string" | "number" | "boolean" | "json";

/** A typed data input that may be bound to an upstream node's output via an
 *  edge (`ref = "<nodeId>.<outputKey>"`), falling back to a literal value in
 *  `params[key]` when unbound. */
export interface WorkflowNodeInput {
  key: string;
  ref: string | null;
}

/** One execution unit inside a workflow. All kinds share the generic fields
 *  below; kind-specific differences are declared in the registry
 *  (lib/shared/workflow-nodes.ts) and stored opaquely in `params`/`inputs`. */
export interface WorkflowNode {
  id: string;
  workflowId: string;
  kind: WorkflowNodeKind;
  name: string;
  /** Agent prompt (kind === "agent"); template supports {{steps.*}} etc. */
  prompt: string;
  /** Explicit cwd for this node (agents). `null` → the workflow's default. */
  cwd: string | null;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  toolNames: string[] | null;
  /** Safety net for a single node run (see scheduler's maxLifetimeMs). */
  maxLifetimeMs: number | null;
  /** Literal input parameters for function nodes (keyed by the kind's param
   *  defs). For agents this doubles as an extended-options bag. */
  params: Record<string, unknown>;
  /** Data-input bindings to upstream node outputs (`{"<nodeId>":"<outputKey>"}`). */
  inputs: WorkflowNodeInput[];
  /** Node ids this node depends on (DAG edges). A node runs only after every id
   *  in this list has completed successfully. A workflow with no edges runs all
   *  nodes (as independent roots); the visual editor auto-chains on add. */
  dependsOn: string[];
  failurePolicy: WorkflowFailurePolicy;
  /** Number of execution attempts before failure policy kicks in (>=1). */
  maxAttempts: number;
  /** Display / insertion order within the workflow. */
  position: number;
  /** Canvas coords for the visual orchestration editor (absolute units). */
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  triggerType: WorkflowTriggerType;
  /** Cron expression when triggerType === "cron" (else null). */
  cron: string | null;
  timezone: string;
  enabled: boolean;
  /** Default cwd used by nodes that don't override their own. */
  cwd: string;
  notification: TaskNotification | null;
  nodes: WorkflowNode[];
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: WorkflowRunStatus | null;
}

/** Input payload accepted by manual triggers — exposed to nodes as
 *  `{{trigger.input.<key>}}`. */
export type WorkflowTriggerInput = Record<string, string>;

/** A single execution instance of a whole workflow. */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  trigger: "manual" | "cron";
  triggerInput: WorkflowTriggerInput | null;
  status: WorkflowRunStatus;
  error: string | null;
  /** Concatenated final reply text (last successful node's reply). */
  replyText: string | null;
  startedAt: number;
  endedAt: number | null;
}

/** A single node's execution within a workflow run. */
export interface WorkflowRunNode {
  id: string;
  runId: string;
  nodeId: string;
  status: WorkflowNodeRunStatus;
  attempts: number;
  /** The prompt actually sent (after template rendering). */
  renderInput: string | null;
  replyText: string | null;
  error: string | null;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

export interface NodeCreateInput {
  /** Stable node id. When omitted the server generates one and dependent
   *  `dependsOn` references must match what the client sends (the visual
   *  editor always supplies ids so edge wiring round-trips correctly). */
  id?: string;
  kind?: WorkflowNodeKind;
  name: string;
  prompt?: string;
  cwd?: string | null;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  toolNames?: string[] | null;
  maxLifetimeMs?: number | null;
  params?: Record<string, unknown>;
  inputs?: WorkflowNodeInput[];
  failurePolicy?: WorkflowFailurePolicy;
  maxAttempts?: number;
  /** Explicit DAG edges: this node depends on these node ids. Omitted → the
   *  store auto-chains in insertion order (linear default). */
  dependsOn?: string[];
  /** Canvas coords. Omitted for any node → the whole graph gets an automatic
   *  layered layout on save. */
  x?: number;
  y?: number;
}

export interface WorkflowCreateInput {
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  cron?: string | null;
  timezone?: string;
  enabled?: boolean;
  cwd: string;
  notification?: TaskNotification | null;
  nodes?: NodeCreateInput[];
}

export interface WorkflowUpdateInput extends Partial<Omit<WorkflowCreateInput, "nodes">> {
  id: string;
  nodes?: NodeCreateInput[];
}