import { NextResponse } from "next/server";
import { getTerminalInfo, startTerminalServer } from "@/lib/terminal/server";

/**
 * Returns the terminal server's WS port + auth token. The token is what
 * gates every WebSocket connection — treat this route as the terminal's
 * authentication boundary (same trust level as the rest of Pi Work).
 */
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
