import { NextRequest, NextResponse } from "next/server";
import {
  groupPlans,
  isDateKey,
  parsePlanAnchor,
  sanitizePlanTitle,
  type PlansResponse,
} from "@/lib/shared/plans";
import { createPlan, listPlans, PlanStoreError } from "@/lib/server/plans/store";

function fail(error: unknown) {
  if (error instanceof PlanStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[plans] operation failed", error);
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

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
    return fail(error);
  }
}

interface CreatePlanBody {
  title?: unknown;
  anchor?: unknown;
  note?: unknown;
}

/**
 * POST /api/plans → create a plan file.
 *
 * body: `{ title, anchor, note? }`, where `anchor` is a `PlanAnchor`
 * (`{ kind: "inbox" }` / `{ kind: "day", date }`); a missing or null anchor
 * means the inbox. The client defaults the anchor to *its* today — the server
 * never invents a date. An empty title and a malformed anchor are rejected
 * with 400 rather than creating a file somewhere unexpected.
 */
export async function POST(request: NextRequest) {
  let body: CreatePlanBody;
  try {
    body = (await request.json()) as CreatePlanBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const anchor = parsePlanAnchor(body.anchor ?? { kind: "inbox" });
  if (anchor === null) {
    return NextResponse.json({ error: "Invalid anchor", field: "anchor" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : "";
  if (!sanitizePlanTitle(title)) {
    return NextResponse.json({ error: "Title is required", field: "title" }, { status: 400 });
  }

  try {
    const note = typeof body.note === "string" ? body.note : undefined;
    return NextResponse.json({ plan: createPlan({ title, anchor, note }) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
