// Client-side API access for the Plans panel. Thin wrappers around
// /api/plans — fetch only, no server logic.
//
// The write *session*'s vocabulary lives in `./plan-write-session` (the conflict
// code, the retry kinds, `planWriteFailure`, `planConflictSurface`); this module
// keeps the HTTP client and the transport error it throws, and re-exports that
// vocabulary so the panel and the existing tests still read it from here.
import { jsonOrThrow } from "./http";
import { PlanConflictError } from "./plan-write-session";
import type { Plan, PlanAnchor, PlanConflictCode, PlansResponse } from "@/lib/shared/plans";

export { PlanConflictError };
export { planConflictSurface, planWriteFailure } from "./plan-write-session";
export type {
  PlanConflictRetry,
  PlanConflictState,
  PlanConflictSurface,
  PlanWriteFailure,
} from "./plan-write-session";

/**
 * Fetch the grouped plan list for a local date key. `refresh` bypasses the
 * server's mtime cache (the manual refresh button).
 */
export async function fetchPlans(today: string, refresh = false): Promise<PlansResponse> {
  const query = new URLSearchParams({ today });
  if (refresh) query.set("refresh", "1");
  return jsonOrThrow<PlansResponse>(await fetch(`/api/plans?${query.toString()}`, { method: "GET" }));
}

/**
 * Create a plan file. `anchor: null` means the inbox; the caller decides the
 * default date (the panel passes its local today).
 */
export async function createPlan(input: {
  title: string;
  anchor: PlanAnchor | null;
  note?: string;
}): Promise<Plan> {
  const res = await fetch("/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const { plan } = await jsonOrThrow<{ plan: Plan }>(res);
  return plan;
}

/** Width at which the detail dialog can afford two readable columns. */
export const PLAN_DIALOG_SPLIT_MIN_WIDTH = 700;

/**
 * The detail dialog's layout for a given available width: edit and preview side
 * by side when there is room, otherwise one pane plus a 编辑 / 预览 switch. The
 * choice is component state only — it is re-derived on every open and never
 * stored.
 *
 * It is the notes panel's answer to the same problem (a pane too narrow to hold
 * both), but not the same mechanism: the notes panel switches on the right
 * panel's expanded state, while this dialog measures its own width, so two
 * columns can never end up as two slivers.
 */
export type PlanDialogLayout = "split" | "tabs";

export function planDialogLayout(availableWidth: number): PlanDialogLayout {
  return availableWidth >= PLAN_DIALOG_SPLIT_MIN_WIDTH ? "split" : "tabs";
}

/**
 * Update a plan in place (note, completion, anchor and/or title).
 *
 * `expectedMtime` is the file's `mtime` as the panel last saw it; a stale
 * value (or a path that is gone) throws `PlanConflictError` instead of writing.
 * `force` is the user's 「覆盖」 answer to that conflict. A different `anchor`
 * makes the server move / rename the file, which is what re-scheduling *is*; a
 * different `title` makes it rename the file in place, leaving the anchor (and
 * therefore the date) exactly where it was.
 */
export async function updatePlan(input: {
  path: string;
  note?: string;
  done?: boolean;
  anchor?: PlanAnchor;
  title?: string;
  expectedMtime?: string;
  force?: boolean;
}): Promise<Plan> {
  const res = await fetch("/api/plans/file", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: PlanConflictCode;
      movedTo?: string | null;
      target?: string | null;
    };
    throw new PlanConflictError(
      body.code ?? "modified",
      body.error ?? "The plan file changed on disk",
      body.movedTo ?? null,
      body.target ?? null,
    );
  }
  const { plan } = await jsonOrThrow<{ plan: Plan }>(res);
  return plan;
}

/** Delete a plan file. The caller confirms with the user first. */
export async function deletePlan(path: string): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/plans/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  );
}
