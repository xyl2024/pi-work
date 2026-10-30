import { NextResponse } from "next/server";
import { runNpxStream } from "@/lib/server/npx";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";
import type { SkillInstallEvent, SkillInstallRequest } from "@/lib/shared/skills";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const INSTALL_TIMEOUT_MS = 60000;
const log = createLogger("api/skills/install");

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const { package: pkg, scope, cwd } = await req.json() as Partial<SkillInstallRequest>;
    if (!pkg?.trim()) {
      log.warn("skill install rejected", { reason: "missing package", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "package required" }, { status: 400 });
    }

    const isGlobal = scope !== "project";
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");

    log.info("skill install started", {
      package: pkg.trim(),
      scope: isGlobal ? "global" : "project",
      cwd: !isGlobal ? cwd : undefined,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: SkillInstallEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
          }
        };
        try {
          const { stdout, stderr } = await runNpxStream(args, {
            timeout: INSTALL_TIMEOUT_MS,
            cwd: !isGlobal && cwd ? cwd : undefined,
            env: { ...sanitizeChildEnv(process.env), FORCE_COLOR: "0" },
            onLine: (line) => send({ type: "log", line }),
          });

          const output = (stdout + stderr).replace(ANSI_RE, "");
          const success = /Installation complete|Installed \d+ skill/.test(output);
          if (!success) {
            log.warn("skill install failed", {
              package: pkg.trim(),
              scope: isGlobal ? "global" : "project",
              durationMs: elapsedMs(startedAt),
            });
            send({ type: "error", message: output.slice(-300) || "Install failed" });
            return;
          }
          log.info("skill install completed", {
            package: pkg.trim(),
            scope: isGlobal ? "global" : "project",
            durationMs: elapsedMs(startedAt),
          });
          send({ type: "done", message: output.trim() });
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
          log.error("skill install error", { error: err.message ?? String(e), durationMs: elapsedMs(startedAt) });
          send({ type: "error", message: output || (err.message ?? String(e)) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e: unknown) {
    log.error("skill install error", { error: String(e), durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
