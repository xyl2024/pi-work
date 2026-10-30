import { NextResponse } from "next/server";
import { getTerminalInfo, startTerminalServer } from "@/lib/server/terminal/server";

export async function GET() {
  const current = getTerminalInfo();
  if (!current) {
    try {
      await startTerminalServer();
    } catch (err) {
      return NextResponse.json({ error: `Terminal server failed to start: ${String(err)}` }, { status: 500 });
    }
  }
  const { port, token } = getTerminalInfo()!;
  return NextResponse.json({ port, token });
}
