import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ISOLATED_AGENT_DIR } from "../config";
import { api, uniqueId } from "./helpers";

const agentDir = ISOLATED_AGENT_DIR.replace(/^~(?=$|\/)/, homedir());
const sessionDir = join(agentDir, "sessions", "--tmp-pi-work-assistant-filter--");

const fixture = uniqueId("pa04");
const cwd = `/tmp/pi-work-assistant-filter-${fixture}`;
const plainId = `${fixture}-plain`;
const assistantId = `${fixture}-assistant`;
const paths: string[] = [];

function writeSession(id: string, assistant: boolean): string {
  const markerId = `${id}-marker`;
  const userParentId = assistant ? markerId : null;
  const lines = [
    {
      type: "session",
      version: 3,
      id,
      timestamp: "2026-03-01T00:00:00.000Z",
      cwd,
    },
    ...(assistant
      ? [{
          type: "custom",
          id: markerId,
          parentId: null,
          timestamp: "2026-03-01T00:00:00.100Z",
          customType: "pi_work_assistant_session",
          data: { version: 1 },
        }]
      : []),
    {
      type: "message",
      id: `${id}-user`,
      parentId: userParentId,
      timestamp: "2026-03-01T00:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `hello ${id}` }],
        timestamp: Date.parse("2026-03-01T00:00:01.000Z"),
      },
    },
    {
      type: "message",
      id: `${id}-assistant`,
      parentId: `${id}-user`,
      timestamp: "2026-03-01T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `hi ${id}` }],
        model: "test-model",
        provider: "test-provider",
        timestamp: Date.parse("2026-03-01T00:00:02.000Z"),
      },
    },
  ];
  const filePath = join(sessionDir, `${id}.jsonl`);
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  paths.push(filePath);
  return filePath;
}

async function waitForSessionList(): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const { status, body } = await api(`/api/sessions?cwd=${encodeURIComponent(cwd)}&limit=50`);
    if (status === 200 && Array.isArray(body.sessions)) {
      const ids = (body.sessions as Array<{ id: string }>).map((session) => session.id);
      if (ids.includes(plainId)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated session list did not pick up the fixture");
}

beforeAll(() => {
  mkdirSync(sessionDir, { recursive: true });
  writeSession(plainId, false);
  writeSession(assistantId, true);
});

afterAll(() => {
  for (const filePath of paths) rmSync(filePath, { force: true });
});

describe("assistant sessions outside the coding lists", () => {
  it("keeps assistant sessions out of the session list and workspace groups", async () => {
    await waitForSessionList();

    const list = await api(`/api/sessions?cwd=${encodeURIComponent(cwd)}&limit=50`);
    expect(list.status).toBe(200);
    const listedIds = (list.body.sessions as Array<{ id: string }>).map((session) => session.id);
    expect(listedIds).toContain(plainId);
    expect(listedIds).not.toContain(assistantId);

    const workspaces = await api("/api/workspaces?limit=all");
    expect(workspaces.status).toBe(200);
    const workspace = (workspaces.body.workspaces as Array<{ cwd: string; totalSessions: number }>)
      .find((row) => row.cwd === cwd);
    expect(workspace?.totalSessions).toBe(1);
  });

  it("still reaches an assistant session directly by id", async () => {
    const direct = await api(`/api/sessions/${assistantId}`);
    expect(direct.status).toBe(200);
    expect(direct.body.sessionId).toBe(assistantId);
    expect((direct.body.info as { id?: string } | null)?.id).toBe(assistantId);
  });
});
