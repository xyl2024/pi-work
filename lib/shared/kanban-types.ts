// ── Kanban shared types (client + server) ────────────────────────────────
// Mirrors the kanban_tasks SQLite row in lib/server/kanban/db.ts. Kept in
// lib/shared so the panel UI and the server store agree on the wire shape.

export type KanbanStatus =
  | "backlog"
  | "in_progress"
  | "review_test"
  | "done";

/** One Kanban task card. Status drives which column it lives in:
 *  - backlog:      created, awaiting a run
 *  - in_progress:  a pi session is executing its prompt right now
 *  - review_test:  the run finished (success or error) — awaiting manual review
 *  - done:         user moved it out of review manually
 */
export interface KanbanTask {
  id: string;
  /** Display name — optional; falls back to a derived name at create time
   *  (first non-empty line of the prompt). */
  taskName: string;
  prompt: string;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  cwd: string;
  /** "all" = every registered tool; [] = none (Off); a non-empty array =
   *  a custom subset (only the names of the selected tools). */
  toolNames: string[] | "all" | null;
  status: KanbanStatus;
  /** Set when the run failed/aborted — the card lands in review_test with
   *  this message so the failure survives for the user to inspect. */
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  sessionId: string | null;
  /** The last assistant text from the finished run (trimmed). */
  resultSummary: string | null;
  /** Ordering within the Backlog column (created/edited order). */
  sortOrder: number;
  /** Optional live/derived stats for the task's (finished) run. Computed
   *  server-side from the linked session's JSONL when a `sessionId` exists;
   *  null for idle backlog cards or when the stats are unavailable. */
  stats: KanbanTaskStats | null;
  /** Context-window occupancy for the linked session — mirrors the live
   *  `getContextUsage()` circle shown in the chat top bar. Percent is the
   *  estimated context tokens over the model's context window; `null` when
   *  the data can't be derived (no model window, no session, etc.). */
  contextUsage: KanbanContextUsage | null;
}

/** Context-window occupancy for a task's linked session. Mirrors
 *  `components/chat/ContextUsageBar`'s `ContextUsage` shape. */
export interface KanbanContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/** Aggregated stats for a task's session run, shown on the card so the user
 *  gets a feel for how much the agent did without opening the full session. */
export interface KanbanTaskStats {
  /** Number of assistant turns (messages) in the session's active branch. */
  messageCount: number;
  /** Total number of tool calls issued across those messages. */
  toolCallCount: number;
  /** Number of distinct files touched by edit/write calls. */
  changedFileCount: number;
  /** Lines added across edit/write calls (+). */
  additions: number;
  /** Lines deleted across edit/write calls (−). */
  deletions: number;
  /** Cumulative wall-clock run time (ms), summed per turn across the
   *  session's active branch: each turn is measured from its user message
   *  to the last entry on that turn, so idle gaps between the user's
   *  prompts are excluded. 0 when no timestamps are available. */
  runDurationMs: number;
}

export interface CreateKanbanTaskInput {
  /** Optional display name. Blank / omitted ⇒ derived from the prompt. */
  taskName?: string;
  prompt: string;
  cwd: string;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  toolNames?: string[] | "all" | null;
}

export interface UpdateKanbanTaskInput {
  taskName?: string;
  prompt?: string;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  cwd?: string;
  toolNames?: string[] | "all" | null;
  status?: KanbanStatus;
  /** Reorder within a column (the new index-to position's sortOrder). */
  sortOrder?: number;
}

/** Canonical column order — used by the UI layout and the store's
 *  per-column counts. */
export const KANBAN_STATUS_ORDER: KanbanStatus[] = [
  "backlog",
  "in_progress",
  "review_test",
  "done",
];