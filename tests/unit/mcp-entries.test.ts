import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMcpPanelChanges, readMcpPanelData } from "@/lib/server/mcp-entries";

/**
 * The MCP panel's read/write half (lib/server/mcp-entries.ts).
 *
 * These files are the user's real pi configuration, so the contract worth
 * pinning is not "the panel can write" but "writing does not lose anything else
 * in the file": unknown top-level keys, entries pi rejects, key order. See
 * ADR-0010.
 */

const created: string[] = [];

function sandbox(): { agentDir: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-work-mcp-panel-"));
  created.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return { agentDir, cwd };
}

function globalPath(agentDir: string): string {
  return join(agentDir, "mcp.json");
}

function projectPath(cwd: string): string {
  return join(cwd, ".pi", "mcp.json");
}

function write(path: string, body: unknown, indent = 2): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, indent)}\n`, "utf8");
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mcp-entries: reading", () => {
  it("lists both files and marks the name a project entry overrides", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: { docs: { url: "https://global.example/mcp" }, local: { command: "x" } } });
    write(projectPath(cwd), { mcpServers: { docs: { url: "https://project.example/mcp" } } });

    const data = readMcpPanelData({ agentDir, cwd, projectTrusted: true });

    expect(data.entries.map((entry) => `${entry.scope}:${entry.name}`)).toEqual(["global:docs", "global:local", "project:docs"]);
    const [globalDocs, , projectDocs] = data.entries;
    expect(globalDocs.shadowedByProject).toBe(true);
    expect(globalDocs.shadowsGlobal).toBe(false);
    expect(projectDocs.shadowsGlobal).toBe(true);
    expect(projectDocs.rawJson).toContain("project.example");
    expect(data.errors).toEqual([]);
  });

  it("keeps an entry pi rejects visible, with the reason", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: { broken: { command: "x", args: [1] }, fine: { command: "ok" } } });

    const data = readMcpPanelData({ agentDir, cwd, projectTrusted: false });

    expect(data.entries.map((entry) => entry.name)).toEqual(["broken", "fine"]);
    expect(data.entries[0].error).toContain("args must be an array of strings");
    expect(data.entries[1].error).toBeNull();
    expect(data.errors.join("\n")).toContain("args must be an array of strings");
  });

  it("reports a value that is not an object at all instead of dropping it", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: { weird: "npx something" } });

    const data = readMcpPanelData({ agentDir, cwd, projectTrusted: false });

    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].rawJson).toBe('"npx something"');
    expect(data.entries[0].error).toContain("must be an object");
  });

  it("reports a file whose JSON does not parse, and the shape pi rejects", () => {
    const { agentDir, cwd } = sandbox();
    writeFileSync(globalPath(agentDir), "{ not json", "utf8");

    const broken = readMcpPanelData({ agentDir, cwd, projectTrusted: false });
    expect(broken.files[0].parseError).toBeTruthy();
    expect(broken.entries).toEqual([]);

    write(globalPath(agentDir), { mcpServers: [] });
    expect(readMcpPanelData({ agentDir, cwd, projectTrusted: false }).files[0].parseError).toContain("mcpServers");
  });

  it("reads autoEnableCodemode per file and flags a wrong type", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: {}, autoEnableCodemode: false });

    const data = readMcpPanelData({ agentDir, cwd, projectTrusted: false });
    expect(data.files[0].autoEnableCodemode).toBe(false);
    expect(data.files[1].autoEnableCodemode).toBeNull();
    expect(data.files[1].exists).toBe(false);

    write(globalPath(agentDir), { mcpServers: {}, autoEnableCodemode: "no" });
    const wrong = readMcpPanelData({ agentDir, cwd, projectTrusted: false });
    expect(wrong.files[0].autoEnableCodemode).toBeNull();
    expect(wrong.errors.join("\n")).toContain("autoEnableCodemode must be a boolean");
  });
});

describe("mcp-entries: writing", () => {
  it("upserts one entry and leaves unknown keys, invalid entries and order alone", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), {
      $schema: "https://example.com/mcp.schema.json",
      mcpServers: {
        broken: { command: "x", args: [1] },
        docs: { url: "https://old.example/mcp" },
      },
    });

    const errors = applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [{ scope: "global", operations: [{ op: "upsert", name: "docs", config: { url: "https://new.example/mcp" } }] }],
    });

    expect(errors).toEqual([]);
    const written = JSON.parse(readFileSync(globalPath(agentDir), "utf8")) as Record<string, unknown>;
    expect(written.$schema).toBe("https://example.com/mcp.schema.json");
    expect(Object.keys(written.mcpServers as Record<string, unknown>)).toEqual(["broken", "docs"]);
    expect((written.mcpServers as Record<string, { url: string }>).broken).toEqual({ command: "x", args: [1] });
    expect((written.mcpServers as Record<string, { url: string }>).docs).toEqual({ url: "https://new.example/mcp" });
  });

  it("creates the workspace file and the mcpServers object when neither exists", () => {
    const { agentDir, cwd } = sandbox();

    const errors = applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [
        {
          scope: "project",
          operations: [{ op: "upsert", name: "files", config: { command: "npx", args: ["-y", "server"] } }],
        },
      ],
    });

    expect(errors).toEqual([]);
    expect(existsSync(projectPath(cwd))).toBe(true);
    expect(JSON.parse(readFileSync(projectPath(cwd), "utf8"))).toEqual({
      mcpServers: { files: { command: "npx", args: ["-y", "server"] } },
    });
  });

  it("removes an entry, and deletes autoEnableCodemode when it is turned back on", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { autoEnableCodemode: false, mcpServers: { gone: { command: "x" }, kept: { command: "y" } } });

    const errors = applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [{ scope: "global", operations: [{ op: "remove", name: "gone" }], autoEnableCodemode: null }],
    });

    expect(errors).toEqual([]);
    const written = JSON.parse(readFileSync(globalPath(agentDir), "utf8")) as Record<string, unknown>;
    expect(written.autoEnableCodemode).toBeUndefined();
    expect(Object.keys(written.mcpServers as Record<string, unknown>)).toEqual(["kept"]);
  });

  it("drops the keys pi applies as defaults", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: {} });

    applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [
        {
          scope: "global",
          operations: [
            {
              op: "upsert",
              name: "tidy",
              config: { command: "x", enabled: true, exposure: "codemode", args: [], env: {}, keep: "yes" },
            },
          ],
        },
      ],
    });

    const written = JSON.parse(readFileSync(globalPath(agentDir), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(written.mcpServers.tidy).toEqual({ command: "x", keep: "yes" });
  });

  it("writes nothing at all when one entry fails validation", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: { existing: { command: "x" } } });
    const before = readFileSync(globalPath(agentDir), "utf8");

    const errors = applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [
        { scope: "global", operations: [{ op: "upsert", name: "bad name", config: { command: "x" } }] },
        { scope: "project", operations: [{ op: "upsert", name: "fine", config: {} }] },
      ],
    });

    expect(errors.join("\n")).toContain("invalid server name");
    expect(errors.join("\n")).toContain('needs either "command"');
    expect(readFileSync(globalPath(agentDir), "utf8")).toBe(before);
    expect(existsSync(projectPath(cwd))).toBe(false);
  });

  it("refuses to touch a file whose JSON is broken", () => {
    const { agentDir, cwd } = sandbox();
    writeFileSync(globalPath(agentDir), "{ not json", "utf8");

    const errors = applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [{ scope: "global", operations: [{ op: "upsert", name: "x", config: { command: "x" } }] }],
    });

    expect(errors).toHaveLength(1);
    expect(readFileSync(globalPath(agentDir), "utf8")).toBe("{ not json");
  });

  it("keeps the indentation the file already uses", () => {
    const { agentDir, cwd } = sandbox();
    write(globalPath(agentDir), { mcpServers: { one: { command: "x" } } }, 4);

    applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [{ scope: "global", operations: [{ op: "upsert", name: "two", config: { command: "y" } }] }],
    });

    expect(readFileSync(globalPath(agentDir), "utf8")).toContain('\n    "mcpServers"');
  });

  it("does not write when the change turns out to be a no-op", () => {
    const text = `${JSON.stringify({ mcpServers: { one: { command: "x" } } }, null, 2)}\n`;
    const { agentDir, cwd } = sandbox();
    writeFileSync(globalPath(agentDir), text, "utf8");

    applyMcpPanelChanges({
      agentDir,
      cwd,
      changes: [{ scope: "global", operations: [{ op: "remove", name: "missing" }] }],
    });

    expect(readFileSync(globalPath(agentDir), "utf8")).toBe(text);
  });
});
