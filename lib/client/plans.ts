// Client-side API access for the Plans panel. Thin wrappers around
// /api/plans — fetch only, no server logic.
import { jsonOrThrow } from "./http";
import type { PlansResponse } from "@/lib/shared/plans";

/**
 * Fetch the grouped plan list for a local date key. `refresh` bypasses the
 * server's mtime cache (the manual refresh button).
 */
export async function fetchPlans(today: string, refresh = false): Promise<PlansResponse> {
  const query = new URLSearchParams({ today });
  if (refresh) query.set("refresh", "1");
  return jsonOrThrow<PlansResponse>(await fetch(`/api/plans?${query.toString()}`, { method: "GET" }));
}
