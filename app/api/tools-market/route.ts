import { NextResponse } from "next/server";
import { TOOL_MARKET_DEFINITIONS } from "@/lib/shared/tools-market";
import { readEnabledTools } from "@/lib/server/tools-market-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tools: TOOL_MARKET_DEFINITIONS, enabled: readEnabledTools() });
}
