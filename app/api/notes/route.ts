import { NextRequest, NextResponse } from "next/server";
import {
  createFolder,
  createNote,
  listTree,
  NotesError,
} from "@/lib/server/notes/store";

function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(error: unknown) {
  if (error instanceof NotesError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[notes] operation failed", error);
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

/** GET /api/notes → the full note tree. */
export async function GET() {
  try {
    return ok({ tree: listTree() });
  } catch (e) {
    return fail(e);
  }
}

interface CreateBody {
  type?: "note" | "folder";
  dir?: string;
  name?: string;
}

/** POST /api/notes → create a note or an empty folder.
 *  body: { type: 'note'|'folder', dir: relDir, name: title/folderName } */
export async function POST(request: NextRequest) {
  try {
    let body: CreateBody;
    try {
      body = (await request.json()) as CreateBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const type = body.type === "folder" ? "folder" : "note";
    const dir = typeof body.dir === "string" ? body.dir : "";
    const name = typeof body.name === "string" ? body.name : "";

    if (type === "folder") {
      createFolder(dir, name);
      return ok({ ok: true });
    }
    const created = createNote(dir, name);
    return ok({ ok: true, note: created }, 201);
  } catch (e) {
    return fail(e);
  }
}