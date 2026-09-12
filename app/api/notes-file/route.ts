import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { NotesError, resolveNoteFileAbs } from "@/lib/server/notes/store";
import { normalizeNotePath } from "@/lib/shared/notes";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** GET /api/notes-file?p=<note-relative-path> → serve a note attachment (image). */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams.get("p") ?? "";
  if (!p) return new NextResponse("Bad Request", { status: 400 });
  const rel = normalizeNotePath(p);
  let abs: string;
  try {
    abs = resolveNoteFileAbs(rel);
  } catch (e) {
    if (e instanceof NotesError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Server Error", { status: 500 });
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) return new NextResponse("Not Found", { status: 404 });

  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(abs);
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}