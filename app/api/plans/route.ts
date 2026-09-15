import { NextRequest, NextResponse } from "next/server";
import { groupPlans, isDateKey, type PlansResponse } from "@/lib/shared/plans";
import { listPlans, PlanStoreError } from "@/lib/server/plans/store";

/**
 * GET /api/plans?today=YYYY-MM-DD[&refresh=1]
 *
 * The client sends its *local* date key; the server never guesses a timezone.
 * Sections are computed against that key, so "today / overdue / upcoming" are
 * the browser's calendar, not the server's. `refresh=1` drops the in-process
 * mtime cache so a manual refresh always re-reads the files.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const today = params.get("today") ?? "";
  if (!isDateKey(today)) {
    return NextResponse.json(
      { error: "Invalid today; expected a YYYY-MM-DD date" },
      { status: 400 },
    );
  }

  try {
    const { plans, unsorted } = listPlans(params.get("refresh") === "1");
    const body: PlansResponse = { today, sections: groupPlans(plans, today), unsorted };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof PlanStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[plans] list failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
