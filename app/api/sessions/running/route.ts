import { NextResponse } from "next/server";
import { listRunningRpcSessions } from "@/lib/server/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = listRunningRpcSessions();
  return NextResponse.json({ sessions });
}
