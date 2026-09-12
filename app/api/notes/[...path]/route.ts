import { NextRequest, NextResponse } from "next/server";
import {
  deleteEntry,
  moveEntry,
  readNote,
  renameEntry,
  saveNoteImage,
  writeNote,
  NotesError,
} from "@/lib/server/notes/store";
import { normalizeNotePath } from "@/lib/shared/notes";

function fail(error: unknown) {
  if (error instanceof NotesError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[notes] per-note operation failed", error);
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

/** GET /api/notes/...path → read a note file. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  try {
    return NextResponse.json(readNote(normalizeNotePath(segs.join("/"))));
  } catch (e) {
    return fail(e);
  }
}

/** PUT /api/notes/...path → overwrite a note file with `content`. */
/** PUT /api/notes/...path → overwrite a note file with `content`. */
export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  try {
    let body: { content?: string };
    try {
      body = (await request.json()) as { content?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "Missing 'content' field" }, { status: 400 });
    }
    const saved = writeNote(normalizeNotePath(segs.join("/")), body.content);
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    return fail(e);
  }
}

interface PatchBody {
  op?: "rename" | "move";
  newName?: string;
  destDir?: string;
  isNote?: boolean;
}

/** POST /api/notes/...path → upload an image attachment for the note at this path.
 *  multipart body with a `file` field. Returns { url, relPath }. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  try {
    const rel = normalizeNotePath(segs.join("/"));
    if (!rel.toLowerCase().endsWith(".md")) {
      return NextResponse.json({ error: "Image upload targets a note" }, { status: 400 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const { relPath, url } = saveNoteImage(rel, file.name, buf);
    return NextResponse.json({ ok: true, url, relPath });
  } catch (e) {
    return fail(e);
  }
}

/** PATCH /api/notes/...path → rename or move an entry. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  try {
    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const rel = normalizeNotePath(segs.join("/"));
    const isNote = body.isNote !== false && rel.toLowerCase().endsWith(".md");

    if (body.op === "move") {
      const destDir = typeof body.destDir === "string" ? body.destDir : "";
      const res = moveEntry(rel, destDir, isNote);
      if (res === null) return NextResponse.json({ ok: true, samePath: true, newRel: rel });
      return NextResponse.json({ ok: true, newRel: res.newRel });
    }

    if (typeof body.newName !== "string" || !body.newName) {
      return NextResponse.json({ error: "Missing 'newName' field" }, { status: 400 });
    }
    const res = renameEntry(rel, body.newName, isNote);
    return NextResponse.json({ ok: true, newRel: res.newRel });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/notes/...path → delete a note (+ attachments) or folder. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  try {
    const rel = normalizeNotePath(segs.join("/"));
    const isNote = rel.toLowerCase().endsWith(".md");
    deleteEntry(rel, isNote);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}