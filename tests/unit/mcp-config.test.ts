import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMcpConfigForPiWork, validateMcpServerConfig } from "@/lib/server/mcp-config";

/**
 * Pi Work's own mcp.json loader (lib/server/mcp-config.ts).
 *
 * pi's `loadMcpConfig` / `validateMcpServerConfig` are not reachable from the
 * package root, so Pi Work mirrors them. These tests pin the rules the mirror
 * has to keep: which files are read, how entries merge, and which malformed
 * entries are rejected instead of handed to the MCP transport.
 */

const created: string[] = [];

function sandbox(): { agentDir: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-work-mcp-"));
  created.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return { agentDir, cwd };
}

function writeGlobal(agentDir: string, body: unknown): void {
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify(body), "utf8");
}

function writeProject(cwd: string, body: unknown): void {
  writeFileSync(join(cwd, ".pi", "mcp.json"), JSON.stringify(body), "utf8");
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mcp-config: file selection", () => {
  it("reads the global mcp.json", () => {
    const { agentDir, cwd } = sandbox();
    writeGlobal(agentDir, {
      mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } },
    });

    const loaded = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false });

    expect(loaded.errors).toEqual([]);
    expect(loaded.servers.map((entry) => entry.name)).toEqual(["filesystem"]);
    expect(loaded.servers[0].scope).toBe("global");
    expect(loaded.servers[0].config).toMatchObject({ command: "npx" });
  });

  it("ignores the project file unless it is trusted", () => {
    const { agentDir, cwd } = sandbox();
    writeProject(cwd, { mcpServers: { project: { command: "run-me" } } });

    expect(loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false }).servers).toEqual([]);

    const trusted = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: true });
    expect(trusted.servers.map((entry) => entry.name)).toEqual(["project"]);
    expect(trusted.servers[0].scope).toBe("project");
  });

  it("lets a project entry replace a global one with the same name", () => {
    const { agentDir, cwd } = sandbox();
    writeGlobal(agentDir, { mcpServers: { docs: { url: "https://global.example/mcp" } } });
    writeProject(cwd, { mcpServers: { docs: { url: "https://project.example/mcp" } } });

    const loaded = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: true });

    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0].scope).toBe("project");
    expect(loaded.servers[0].config).toMatchObject({ url: "https://project.example/mcp" });
  });

  it("reports a broken entry and keeps the other servers", () => {
    const { agentDir, cwd } = sandbox();
    writeGlobal(agentDir, {
      mcpServers: {
        good: { command: "ok" },
        bad: { command: "oops", args: [1] },
        sse: { url: "https://example.com/sse", type: "sse" },
      },
    });

    const loaded = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false });

    expect(loaded.servers.map((entry) => entry.name)).toEqual(["good"]);
    expect(loaded.errors).toHaveLength(2);
    expect(loaded.errors.join("\n")).toContain("args must be an array of strings");
    expect(loaded.errors.join("\n")).toContain("legacy SSE transport is not supported");
  });

  it("keeps disabled servers listed and carries autoEnableCodemode", () => {
    const { agentDir, cwd } = sandbox();
    writeGlobal(agentDir, {
      autoEnableCodemode: false,
      mcpServers: { off: { command: "x", enabled: false } },
    });

    const loaded = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false });

    expect(loaded.autoEnableCodemode).toBe(false);
    expect(loaded.servers[0].config).toMatchObject({ enabled: false });
  });

  it("survives malformed JSON and a wrong top-level shape", () => {
    const { agentDir, cwd } = sandbox();
    writeFileSync(join(agentDir, "mcp.json"), "{ not json", "utf8");
    expect(loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false }).errors).toHaveLength(1);

    writeGlobal(agentDir, { mcpServers: [] });
    const wrongShape = loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: false });
    expect(wrongShape.servers).toEqual([]);
    expect(wrongShape.errors[0]).toContain('expected an object with an "mcpServers" object');
  });

  it("is a no-op when no mcp.json exists", () => {
    const { agentDir, cwd } = sandbox();
    expect(loadMcpConfigForPiWork({ agentDir, cwd, projectTrusted: true })).toEqual({
      servers: [],
      errors: [],
    });
  });
});

describe("mcp-config: validation", () => {
  it("accepts stdio and streamable HTTP entries", () => {
    expect(validateMcpServerConfig("fs", { command: "npx", args: ["-y", "server"], env: { A: "${B}" } })).toMatchObject({
      command: "npx",
    });
    expect(validateMcpServerConfig("docs", { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } })).toMatchObject({
      url: "https://example.com/mcp",
    });
  });

  it("rejects names outside [A-Za-z0-9_-]", () => {
    expect(validateMcpServerConfig("bad name", { command: "x" })).toContain("invalid server name");
    expect(validateMcpServerConfig("mcp.servers", { command: "x" })).toContain("invalid server name");
  });

  it("rejects an unknown exposure rather than defaulting it", () => {
    expect(validateMcpServerConfig("x", { command: "x", exposure: "codemode-defered" })).toContain("exposure must be one of");
    expect(validateMcpServerConfig("x", { command: "x", toolExposure: { "delete_*": "nope" } })).toContain(
      'toolExposure "delete_*" must be one of',
    );
    expect(validateMcpServerConfig("x", { command: "x", exposure: "direct" })).toMatchObject({ exposure: "direct" });
  });

  it("requires one of command or url", () => {
    expect(validateMcpServerConfig("x", {})).toBe('server "x" needs either "command" (stdio) or "url" (streamable HTTP)');
    expect(validateMcpServerConfig("x", { command: "x", type: "http" })).toContain("needs either");
    expect(validateMcpServerConfig("x", { url: "ftp://example.com" })).toContain("url must be an http or https URL");
  });

  it("validates the oauth block used by remote servers", () => {
    expect(validateMcpServerConfig("x", { url: "https://example.com/mcp", oauth: { callbackPort: 70000 } })).toContain(
      "oauth.callbackPort must be a port number",
    );
    expect(
      validateMcpServerConfig("x", { url: "https://example.com/mcp", oauth: { callbackUrl: "https://evil.example/cb" } }),
    ).toContain("oauth.callbackUrl must be an http URI on localhost");
    expect(
      validateMcpServerConfig("x", { url: "https://example.com/mcp", oauth: { callbackPort: 8765, scope: "read write" } }),
    ).toMatchObject({ url: "https://example.com/mcp" });
  });

  it("validates enabled, timeout, env, cwd and headers", () => {
    expect(validateMcpServerConfig("x", { command: "x", enabled: "yes" })).toContain("enabled must be a boolean");
    expect(validateMcpServerConfig("x", { command: "x", timeout: 0 })).toContain("timeout must be a positive number");
    expect(validateMcpServerConfig("x", { command: "x", env: { A: 1 } })).toContain("env must map names to strings");
    expect(validateMcpServerConfig("x", { command: "x", cwd: 1 })).toContain("cwd must be a string");
    expect(validateMcpServerConfig("x", { url: "https://example.com/mcp", headers: { A: 1 } })).toContain(
      "headers must map names to strings",
    );
  });
});
