/**
 * POST /api/mcp/[name]/call
 *
 * Request body: `{ tool: string, arguments: unknown }`
 * Response: 200 `{ isError, content[] }` for both success-and-business-error
 *          and connection-level errors as `{ error: string }` with status 4xx/5xx.
 *
 * `arguments` is passed through verbatim — the MCP server is the schema
 * authority. The UI surfaces any error string verbatim so the user can
 * see what went wrong.
 */

import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { mcpManager } from "@/lib/mcp/manager";

export const dynamic = "force-dynamic";

const log = createLogger("api/mcp/[name]/call");

interface CallBody {
  tool?: unknown;
  arguments?: unknown;
}

function pickString(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const decoded = decodeURIComponent(name);
  const startedAt = Date.now();
  let body: CallBody;
  try {
    body = (await req.json()) as CallBody;
  } catch (e) {
    return NextResponse.json(
      { error: `invalid JSON body: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  const tool = pickString(body.tool);
  if (!tool) {
    return NextResponse.json(
      { error: "missing or empty `tool` in body" },
      { status: 400 },
    );
  }
  try {
    const result = await mcpManager.callTool(decoded, tool, body.arguments ?? {});
    log.info("mcp callTool", {
      name: decoded,
      tool,
      isError: result.isError,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn("mcp callTool failed", {
      name: decoded,
      tool,
      error: msg,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
