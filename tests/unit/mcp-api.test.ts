/**
 * Interface tests for the MCP panel's API surface (`/api/mcp`):
 *
 *   GET  /api/mcp?cwd=<path>   both mcp.json files as the panel shows them
 *   PUT  /api/mcp              apply the panel's batch of changes
 *
 * Runs against the isolated instance (tests/global-setup.ts), so the global
 * file it touches is the isolated agent dir's, never the real `~/.pi/agent`.
 * The project file lives in a scratch directory under the default workspace
 * root and is removed afterwards.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId } from "./helpers";

async function allowedCwd(): Promise<string> {
  const { status, body } = await api("/api/default-cwd", { method: "POST" });
  expect(status).toBe(200);
  const cwd = body.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) throw new Error("default-cwd did not return a path");
  return cwd;
}

const created: string[] = [];

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(join(dir, ".pi", "mcp.json"), { force: true });
});

describe("/api/mcp", () => {
  it("round-trips a project override and reports it as an override, not an error", async () => {
    const cwd = await allowedCwd();
    if (!created.includes(cwd)) created.push(cwd);
    const name = uniqueId("mcp-override");
    const globalConfig = { url: "https://global.example/mcp", exposure: "direct" };

    const globalRes = await api("/api/mcp", {
      method: "PUT",
      body: JSON.stringify({ cwd, changes: [{ scope: "global", operations: [{ op: "upsert", name, config: globalConfig }] }] }),
    });
    expect(globalRes.status).toBe(200);

    try {
      const projectRes = await api("/api/mcp", {
        method: "PUT",
        body: JSON.stringify({ cwd, changes: [{ scope: "project", operations: [{ op: "upsert", name, config: { enabled: false } }] }] }),
      });
      expect(projectRes.status).toBe(200);

      const read = await api(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      expect(read.status).toBe(200);
      const entries = read.body.entries as { name: string; scope: string; override: boolean; error: string | null }[];
      const project = entries.find((entry) => entry.name === name && entry.scope === "project");
      expect(project?.override).toBe(true);
      expect(project?.error).toBeNull();
    } finally {
      await api("/api/mcp", {
        method: "PUT",
        body: JSON.stringify({
          cwd,
          changes: [
            { scope: "project", operations: [{ op: "remove", name }] },
            { scope: "global", operations: [{ op: "remove", name }] },
          ],
        }),
      });
    }
  });

  it("writes nothing when one change in the batch is invalid", async () => {
    const cwd = await allowedCwd();
    if (!created.includes(cwd)) created.push(cwd);
    const name = uniqueId("mcp-bad-override");

    const globalRes = await api("/api/mcp", {
      method: "PUT",
      body: JSON.stringify({ cwd, changes: [{ scope: "global", operations: [{ op: "upsert", name, config: { command: "keep" } }] }] }),
    });
    expect(globalRes.status).toBe(200);

    try {
      const bad = await api("/api/mcp", {
        method: "PUT",
        body: JSON.stringify({
          cwd,
          changes: [
            { scope: "project", operations: [{ op: "upsert", name, config: { enabled: false, oauth: {} } }] },
          ],
        }),
      });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).toContain("an override can only set enabled, exposure, toolExposure");

      const read = await api(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      const entries = read.body.entries as { name: string; scope: string }[];
      expect(entries.some((entry) => entry.name === name && entry.scope === "project")).toBe(false);
    } finally {
      await api("/api/mcp", {
        method: "PUT",
        body: JSON.stringify({ cwd, changes: [{ scope: "global", operations: [{ op: "remove", name }] }] }),
      });
    }
  });

  it("returns the same snapshot on two clean reads", async () => {
    const cwd = await allowedCwd();
    const first = await api(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
    const second = await api(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("rejects a cwd outside the allowed roots", async () => {
    const res = await api(`/api/mcp?cwd=${encodeURIComponent("/etc")}`);
    expect(res.status).toBe(403);
  });
});
