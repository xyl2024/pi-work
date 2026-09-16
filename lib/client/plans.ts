// Client-side API access for the Plans panel. Thin wrappers around
// /api/plans — fetch only, no server logic.
import { jsonOrThrow } from "./http";
import type { Plan, PlanAnchor, PlansResponse } from "@/lib/shared/plans";

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
