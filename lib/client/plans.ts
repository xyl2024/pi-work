// Client-side API access for the Plans panel. Thin wrappers around
// /api/plans — fetch only, no server logic.
import { jsonOrThrow } from "./http";
import type { Plan, PlanAnchor, PlanConflictCode, PlansResponse } from "@/lib/shared/plans";

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

/**
 * The 409 the panel must answer with 「覆盖 / 重载到新位置」 rather than an error
 * toast: `modified` = the file changed under us, `missing` = it was moved,
 * renamed or deleted. `movedTo` is the server's best guess at the new path.
 *
 * `name-taken` is different: a re-schedule landed on a plan that already exists
 * there. Nothing was written, so there is nothing to overwrite or reload — the
 * panel just reports it (`target` is the occupied path).
 */
export class PlanConflictError extends Error {
  code: PlanConflictCode;
  movedTo: string | null;
  target: string | null;

  constructor(
    code: PlanConflictCode,
    message: string,
    movedTo: string | null,
    target: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.movedTo = movedTo;
    this.target = target;
  }
}

/**
 * What a failed plan write means for the panel. Three shapes, because the
 * panel answers them three different ways:
 *
 * - `name-taken`  — nothing was written and there is nothing to overwrite, so
 *                   the panel only reports the occupied `target`.
 * - `conflict`    — the panel's view was stale; the user answers 「覆盖 / 重载」
 *                   and the refused action is retried from `retry`.
 * - `error`       — anything else (network, 500, unreadable file): a toast.
 *
 * Deciding this is the panel's most repeated branch, so it lives here once,
 * next to the error it is classifying, instead of as an `instanceof` dance at
 * every write site.
 */
export type PlanWriteFailure =
  | { kind: "name-taken"; target: string | null; message: string }
  | {
      kind: "conflict";
      code: Exclude<PlanConflictCode, "name-taken">;
      movedTo: string | null;
      message: string;
    }
  | { kind: "error"; message: string };

/** Classify a rejected `updatePlan` / `deletePlan` call. Never throws. */
export function planWriteFailure(err: unknown): PlanWriteFailure {
  if (err instanceof PlanConflictError) {
    const { code, movedTo, target, message } = err;
    if (code === "name-taken") return { kind: "name-taken", target, message };
    return { kind: "conflict", code, movedTo, message };
  }
  return { kind: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * What 「覆盖」 must redo after the user answers a conflict: the note save, the
 * completion state the checkbox was aiming for, or the re-schedule the chip
 * asked for. Carried as data instead of re-derived from the list, which is
 * stale exactly when a conflict happens.
 */
export type PlanConflictRetry =
  | { kind: "note" }
  | { kind: "done"; done: boolean }
  | { kind: "anchor"; anchor: PlanAnchor };

/** A write the server refused with 409 because the panel's view was stale. */
export interface PlanConflictState {
  /** `modified` = content changed under us, `missing` = moved / renamed / gone. */
  code: "modified" | "missing";
  /** Where the same-titled plan lives now, when the server could tell. */
  movedTo: string | null;
  /** The action that was refused. */
  retry: PlanConflictRetry;
}

/**
 * Where a 409's 「覆盖 / 重载」 banner belongs: at the place that triggered it.
 *
 * A note save is asked for in the detail dialog, so its banner goes there. A
 * completion toggle or a re-schedule is asked for on the row, and the dialog
 * can only edit the note — pulling the user into it would lose the intent they
 * actually expressed.
 */
export type PlanConflictSurface = "dialog" | "row";

export function planConflictSurface(retry: PlanConflictRetry): PlanConflictSurface {
  return retry.kind === "note" ? "dialog" : "row";
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
 * Update a plan in place (note, completion and/or anchor).
 *
 * `expectedMtime` is the file's `mtime` as the panel last saw it; a stale
 * value (or a path that is gone) throws `PlanConflictError` instead of writing.
 * `force` is the user's 「覆盖」 answer to that conflict. A different `anchor`
 * makes the server move / rename the file, which is what re-scheduling *is*.
 */
export async function updatePlan(input: {
  path: string;
  note?: string;
  done?: boolean;
  anchor?: PlanAnchor;
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
