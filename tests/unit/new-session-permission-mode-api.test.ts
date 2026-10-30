import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ISOLATED_DATA_DIR } from "../config";
import { api, expectOk } from "./helpers";

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
