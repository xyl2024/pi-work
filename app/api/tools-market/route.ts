import { NextResponse } from "next/server";
import { TOOL_MARKET_DEFINITIONS, TOOL_MARKET_IDS } from "@/lib/shared/tools-market";
import { readEnabledTools, writeEnabledTools } from "@/lib/server/tools-market-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tools: TOOL_MARKET_DEFINITIONS, enabled: readEnabledTools() });
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { enabled?: unknown };
    if (!Array.isArray(body.enabled)) return NextResponse.json({ error: "enabled must be an array" }, { status: 400 });
    const enabled = writeEnabledTools(body.enabled);
    return NextResponse.json({ enabled, available: TOOL_MARKET_IDS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
