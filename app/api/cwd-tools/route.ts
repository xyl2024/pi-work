import { NextResponse } from "next/server";
import { readCwdToolSelection, writeCwdToolSelection } from "@/lib/server/cwd-tools-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  return NextResponse.json({ cwd, selection: readCwdToolSelection(cwd) });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; selection?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const selection = writeCwdToolSelection(body.cwd, body.selection);
    return NextResponse.json({ cwd: body.cwd, selection });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
