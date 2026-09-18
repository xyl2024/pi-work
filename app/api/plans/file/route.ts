import { NextRequest, NextResponse } from "next/server";
import { parsePlanAnchor, type PlanAnchor } from "@/lib/shared/plans";
import {
  deletePlanFile,
  PlanConflictError,
  PlanStoreError,
  updatePlanFile,
} from "@/lib/server/plans/store";

function fail(error: unknown) {
  if (error instanceof PlanConflictError) {
    // 409 with a machine-readable reason: the panel answers with
    // 「覆盖」/「重载到新位置」 instead of a generic error toast — except for
    // `name-taken`, where 「覆盖」 is not an option and the panel just says so.
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        movedTo: error.movedTo,
        target: error.target,
      },
      { status: error.status },
    );
  }
  if (error instanceof PlanStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[plans] file operation failed", error);
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

interface UpdateBody {
  path?: unknown;
  note?: unknown;
  done?: unknown;
  anchor?: unknown;
  title?: unknown;
  expectedMtime?: unknown;
  force?: unknown;
}

/**
 * PATCH /api/plans/file → update one plan in place.
 *
 * body: `{ path, note?, done?, anchor?, title?, expectedMtime?, force? }`. At
 * least one of `note` / `done` / `anchor` / `title` must be present.
 * `expectedMtime` is the `mtime` the client last saw the file with; a mismatch
 * (or a path that no longer exists) is a `409` carrying `code` (`modified` |
 * `missing`) and, for a moved file, the `movedTo` the panel can reload into.
 * `force: true` is the user's 「覆盖」 answer to that 409 and skips the guard.
 *
 * `anchor` is a re-schedule: the server moves / renames the file to the new
 * month directory (the anchor lives in the path — ADR-0006), preserving
 * `created_at`, the note and the completion state. `title` is a rename: the
 * server renames the file *in place*, keeping the anchor prefix, so the date
 * cannot move. Giving both is one move to the new name. A target name that is
 * already taken is a `409` with `code: "name-taken"` and never overwrites.
 *
 * `done` is applied by the server, which stamps / clears `done_at`; the client
 * never chooses the timestamp.
 */
export async function PATCH(request: NextRequest) {
  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.path !== "string" || !body.path) {
    return NextResponse.json({ error: "Missing 'path' field", field: "path" }, { status: 400 });
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "'note' must be a string", field: "note" }, { status: 400 });
  }
  if (body.done !== undefined && typeof body.done !== "boolean") {
    return NextResponse.json({ error: "'done' must be a boolean", field: "done" }, { status: 400 });
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return NextResponse.json({ error: "'title' must be a string", field: "title" }, { status: 400 });
  }
  if (body.expectedMtime !== undefined && typeof body.expectedMtime !== "string") {
    return NextResponse.json(
      { error: "'expectedMtime' must be a string", field: "expectedMtime" },
      { status: 400 },
    );
  }

  // `null` is the inbox, exactly as it is on create; a malformed anchor is
  // rejected here so a bad date can never become a path segment.
  let anchor: PlanAnchor | undefined;
  if (body.anchor !== undefined) {
    const parsed = parsePlanAnchor(body.anchor ?? { kind: "inbox" });
    if (parsed === null) {
      return NextResponse.json({ error: "Invalid anchor", field: "anchor" }, { status: 400 });
    }
    anchor = parsed;
  }

  try {
    const plan = updatePlanFile({
      path: body.path,
      note: body.note,
      done: body.done,
      anchor,
      title: body.title,
      expectedMtime: body.expectedMtime,
      force: body.force === true,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE /api/plans/file?path=… → delete one plan file. The panel confirms
 *  with the user before calling this; the server asks nothing. */
export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!path) {
    return NextResponse.json({ error: "Missing 'path' query parameter" }, { status: 400 });
  }
  try {
    deletePlanFile(path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
