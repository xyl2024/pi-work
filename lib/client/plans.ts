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
