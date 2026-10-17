import { unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { api, expectOk } from "./helpers";

/**
 * Interface test for "which shell tools does the agent actually get on this
 * machine", asked at the two existing surfaces that answer it:
 *
 *   - `POST /api/agent/tools` is the catalog the tool picker shows for a
 *     session that does not exist yet (it boots an ephemeral pi session);
 *   - `get_tools` on a real session (`POST /api/agent/new`) is the same
 *     registry after Pi Work applied the selection ("all" here) — the list the
 *     model is really offered. It also covers Pi Work's own shell definitions,
 *     which are registered as customTools and have to disappear from the list
 *     on the platforms that cannot run them.
 *
 * The expectation is written against `process.platform` so the same test is
 * meaningful on both tracks: `powershell` must be absent everywhere the SDK's
 * `getPowerShellConfig()` refuses to resolve a shell (it throws off Windows),
 * and present where it is real. `bash` (Git Bash on Windows) must survive
 * everywhere.
 *
 * Both surfaces also answer the second half of the registry denylist: the
 * built-ins Pi Work does not ship (ADR-0015) must be absent from the catalog
 * and from an "all tools" session alike, on every platform.
 */
const shellToolsOf = (tools: Array<{ name: string }>): string[] =>
  tools.map((tool) => tool.name).filter((name) => name === "bash" || name === "powershell");

/** The search-and-list trio removed from the registry in ADR-0015. */
const REMOVED_TOOLS = ["grep", "find", "ls"];

const namesOf = (tools: Array<{ name: string }>): string[] => tools.map((tool) => tool.name);

const powershellExpected = process.platform === "win32";

/**
 * Drop the session the test created, the tolerant way
 * `context-composition-api.test.ts` does: a session that only ever answered
 * `get_tools` may not have appended an entry yet, in which case there is no
 * JSONL on disk to remove.
 */
async function removeSession(sessionId: string): Promise<void> {
  const state = await api(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ type: "get_state" }),
  });
  const sessionFile = (state.body.data as { sessionFile?: string } | undefined)?.sessionFile;
  if (sessionFile) await unlink(sessionFile).catch(() => {});
}

describe("agent shell tools (API)", () => {
  it("offers powershell only where the platform can run it (tool catalog)", async () => {
    const { status, body } = await api("/api/agent/tools", {
      method: "POST",
      body: JSON.stringify({ cwd: process.cwd() }),
    });
    expectOk(status, body);
    const available = (body.data as { available: Array<{ name: string }> }).available;
    expect(available.map((tool) => tool.name)).toContain("bash");
    expect(shellToolsOf(available).includes("powershell")).toBe(powershellExpected);
    for (const removed of REMOVED_TOOLS) {
      expect(namesOf(available)).not.toContain(removed);
    }
  });

  it("offers powershell only where the platform can run it (live session, all tools)", async () => {
    const created = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd: process.cwd(), type: "get_tools", toolNames: "all" }),
    });
    expectOk(created.status, created.body);
    const sessionId = created.body.sessionId as string;
    try {
      const tools = created.body.data as Array<{ name: string; active: boolean }>;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.map((tool) => tool.name)).toContain("bash");
      expect(shellToolsOf(tools).includes("powershell")).toBe(powershellExpected);
      // "all" cannot reach a tool that never entered the registry.
      for (const removed of REMOVED_TOOLS) {
        expect(namesOf(tools)).not.toContain(removed);
      }
    } finally {
      await removeSession(sessionId);
    }
  });
});
