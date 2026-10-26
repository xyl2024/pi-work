import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ISOLATED_DATA_DIR } from "../config";
import { api, expectOk } from "./helpers";

/**
 * Interface test for the new-session screen's permission switch (ADR-0021).
 *
 * The screen has no session id yet, so the shield's pick travels in the
 * `POST /api/agent/new` body and must be applied **before** the first prompt —
 * otherwise the very commands the human just authorized would still stop and
 * ask. `type: "get_state"` is the cheapest way to observe the applied mode
 * through the real route: it boots a pi session and returns `get_state`
 * without calling a model, and the returned `permissionMode` is read off the
 * wrapper that would gate the next tool call.
 *
 * The second case pins the explicit-enumeration rule: an unknown value is
 * rejected before anything is created, never coerced to full access
 * (ADR-0008's "unknown decision means allow" trap).
 *
 * Cleanup: `startRpcSession` names a JSONL but pi only writes it on the first
 * message, so a `get_state`-only session usually has no file to remove. The
 * permission-mode sidecar *is* written eagerly by the very switch under test,
 * so that is the artifact to delete — from the same isolated data root the
 * instance reads (tests/README.md: every test cleans up its own data).
 */
function isolatedDataRoot(): string {
  return ISOLATED_DATA_DIR.startsWith("~/")
    ? path.join(os.homedir(), ISOLATED_DATA_DIR.slice(2))
    : ISOLATED_DATA_DIR;
}

async function cleanupSession(sessionId: string, sessionFile?: string): Promise<void> {
  if (sessionFile) await unlink(sessionFile).catch(() => {});
  await unlink(path.join(isolatedDataRoot(), "session-permission-mode", `${sessionId}.json`)).catch(() => {});
}

describe("new-session permission mode (agent API)", () => {
  it("applies the draft's mode before the first prompt", async () => {
    const { status, body } = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd: process.cwd(),
        type: "get_state",
        permissionMode: "full_access",
      }),
    });
    expectOk(status, body);
    const sessionId = body.sessionId as string;
    const state = body.data as { permissionMode?: string; sessionFile?: string };
    try {
      expect(state.permissionMode).toBe("full_access");
    } finally {
      await cleanupSession(sessionId, state.sessionFile);
    }
  });

  it("leaves a draft that only sent the default in confirm mode", async () => {
    const { status, body } = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd: process.cwd(),
        type: "get_state",
        permissionMode: "confirm",
      }),
    });
    expectOk(status, body);
    const sessionId = body.sessionId as string;
    const state = body.data as { permissionMode?: string; sessionFile?: string };
    try {
      expect(state.permissionMode).toBe("confirm");
    } finally {
      await cleanupSession(sessionId, state.sessionFile);
    }
  });

  it("rejects an unknown mode instead of creating a session", async () => {
    const { status, body } = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd: process.cwd(),
        type: "get_state",
        permissionMode: "yolo",
      }),
    });

    expect(status).toBe(400);
    expect(String(body.error)).toContain("Unknown permission mode");
    expect(body.sessionId).toBeUndefined();
  });
});
