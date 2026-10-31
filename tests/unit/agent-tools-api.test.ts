import { unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { api, expectOk } from "./helpers";

const shellToolsOf = (tools: Array<{ name: string }>): string[] =>
  tools.map((tool) => tool.name).filter((name) => name === "bash" || name === "powershell");

const REMOVED_TOOLS = ["grep", "find", "ls"];

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const namesOf = (tools: Array<{ name: string }>): string[] => tools.map((tool) => tool.name);

const powershellExpected = process.platform === "win32";

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
      for (const removed of REMOVED_TOOLS) {
        expect(namesOf(tools)).not.toContain(removed);
      }
    } finally {
      await removeSession(sessionId);
    }
  });
});

describe("agent get_tools schema (API)", () => {
  it("returns the registered parameters schema verbatim for active tools", async () => {
    const created = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd: process.cwd(), type: "get_state" }),
    });
    expectOk(created.status, created.body);
    const sessionId = created.body.sessionId as string;
    try {
      const { status, body } = await api(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        body: JSON.stringify({ type: "get_tools" }),
      });
      expectOk(status, body);
      const tools = body.data as Array<{
        name: string;
        description: string;
        active: boolean;
        parameters?: unknown;
      }>;
      const active = tools.filter((tool) => tool.active);
      expect(active.length).toBeGreaterThan(0);
      for (const tool of active) {
        expect(isJsonObject(tool.parameters), `${tool.name} parameters`).toBe(true);
        const parameters = tool.parameters as Record<string, unknown>;
        expect(parameters.type, `${tool.name} parameters.type`).toBe("object");
        expect(parameters, `${tool.name} schema is not mixed with exposure state`).not.toHaveProperty("exposure");
        expect(parameters, `${tool.name} schema is not mixed with active state`).not.toHaveProperty("active");
        expect(parameters, `${tool.name} schema is not mixed with the tool name`).not.toHaveProperty("name");
      }
      const bash = tools.find((tool) => tool.name === "bash");
      expect(bash?.active).toBe(true);
      expect(bash?.parameters).toMatchObject({
        type: "object",
        properties: { command: { type: "string" } },
      });
      expect((bash?.parameters as { required?: string[] }).required).toContain("command");
    } finally {
      await removeSession(sessionId);
    }
  }, 60_000);
});

describe("agent tool catalog source probe (API)", () => {
  const catalogNames = async (payload: Record<string, unknown>): Promise<string[]> => {
    const { status, body } = await api("/api/agent/tools", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expectOk(status, body);
    return namesOf((body.data as { available: Array<{ name: string }> }).available);
  };

  it("lists the subagent-only web tools only for the subagent source", async () => {
    const cwd = process.cwd();
    const subagent = await catalogNames({ cwd, source: "subagent" });
    expect(subagent).toContain("web_search");
    expect(subagent).toContain("web_fetch");

    for (const names of [
      await catalogNames({ cwd }),
      await catalogNames({ cwd, source: "user" }),
    ]) {
      expect(names).not.toContain("web_search");
      expect(names).not.toContain("web_fetch");
    }
  }, 180_000);

  it("falls back to the user source for an unknown source value", async () => {
    const names = await catalogNames({ cwd: process.cwd(), source: "unknown" });
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("web_fetch");
  }, 120_000);

  it("keeps the existing validation errors for a missing or unknown cwd", async () => {
    const missing = await api("/api/agent/tools", {
      method: "POST",
      body: JSON.stringify({ source: "subagent" }),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("cwd is required");

    const nonexistent = await api("/api/agent/tools", {
      method: "POST",
      body: JSON.stringify({ cwd: "/definitely/not/a/real/directory", source: "subagent" }),
    });
    expect(nonexistent.status).toBe(400);
    expect(String(nonexistent.body.error)).toContain("Directory does not exist");
  });
});
