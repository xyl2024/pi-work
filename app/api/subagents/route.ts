import { NextResponse } from "next/server";
import { createLogger } from "@/lib/server/logger";
import { isValidSubagentName } from "@/lib/shared/subagent";
import {
  SubagentProfileError,
  createSubagentProfile,
  deleteSubagentProfile,
  listSubagentProfiles,
  normalizeSubagentProfileInput,
  subagentProfileExists,
  updateSubagentProfile,
} from "@/lib/server/subagent-profiles";

export const dynamic = "force-dynamic";

const log = createLogger("api/subagents");

// /api/subagents — the user-defined subagent profiles `spawn_subagent` can
// launch. GET lists them; POST/PUT/DELETE manage one profile keyed by name.
// (The separate /api/subagents/[sessionId]/activity route reads task rows.)

export async function GET() {
  try {
    return NextResponse.json(
      { profiles: listSubagentProfiles() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("list subagent profiles failed", { error });
    return NextResponse.json({ error: "Failed to load subagent profiles" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const input = normalizeSubagentProfileInput(body);
    if (subagentProfileExists(input.name)) {
      return NextResponse.json({ error: `a subagent named "${input.name}" already exists` }, { status: 409 });
    }
    const profile = createSubagentProfile(input);
    log.info("subagent profile created", { name: profile.name });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    if (error instanceof SubagentProfileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    log.error("create subagent profile failed", { error });
    return NextResponse.json({ error: "Failed to create subagent profile" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const input = normalizeSubagentProfileInput(body);
    if (!subagentProfileExists(input.name)) {
      return NextResponse.json({ error: `no subagent named "${input.name}"` }, { status: 404 });
    }
    const profile = updateSubagentProfile(input);
    log.info("subagent profile updated", { name: profile.name });
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof SubagentProfileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    log.error("update subagent profile failed", { error });
    return NextResponse.json({ error: "Failed to update subagent profile" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!isValidSubagentName(name)) {
    return NextResponse.json({ error: "a valid name query parameter is required" }, { status: 400 });
  }
  try {
    if (!deleteSubagentProfile(name)) {
      return NextResponse.json({ error: `no subagent named "${name}"` }, { status: 404 });
    }
    log.info("subagent profile deleted", { name });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("delete subagent profile failed", { name, error });
    return NextResponse.json({ error: "Failed to delete subagent profile" }, { status: 500 });
  }
}
