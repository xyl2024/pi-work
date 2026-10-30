import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DangerousCommandVerdict } from "@/lib/shared/dangerous-commands";

const root = mkdtempSync(join(tmpdir(), "pi-work-dangerous-test-"));

let POST: typeof import("@/app/api/dangerous-commands/test/route")["POST"];
let readConfig: typeof import("@/lib/server/config")["readConfig"];
let writeConfig: typeof import("@/lib/server/config")["writeConfig"];

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  ({ POST } = await import("@/app/api/dangerous-commands/test/route"));
  ({ readConfig, writeConfig } = await import("@/lib/server/config"));
});

beforeEach(() => {
  globalThis.__piWorkConfigCache = undefined;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

function setUserRules(rules: { name: string; pattern: string; ignoreCase?: boolean }[]): void {
  const base = readConfig();
  writeConfig({
    ...base,
    dangerous_patterns: { ...base.dangerous_patterns, rules },
  });
}

async function testCommand(command: unknown) {
  const response = await POST(
    new Request("http://localhost/api/dangerous-commands/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
  );
  return { status: response.status, body: (await response.json()) as DangerousCommandVerdict };
}

describe("POST /api/dangerous-commands/test", () => {
  it("reports a command self-protection would hard-block", async () => {
    setUserRules([]);

    const { status, body } = await testCommand("pkill node");

    expect(status).toBe(200);
    expect(body.kind).toBe("self_protected");
    expect((body as { reason: string }).reason).toEqual(expect.any(String));
    expect((body as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it("reports a user rule match with its name and layer", async () => {
    setUserRules([{ name: "git push", pattern: "git\\s+push" }]);

    const { status, body } = await testCommand("git push origin main");

    expect(status).toBe(200);
    expect(body).toEqual({ kind: "matched", ruleName: "git push", source: "user" });
  });

  it("reports a built-in rule match with its name and layer", async () => {
    setUserRules([]);

    const { status, body } = await testCommand("rm -rf /tmp/x");

    expect(status).toBe(200);
    expect(body).toEqual({ kind: "matched", ruleName: "rm -rf", source: "builtin" });
  });

  it("reports no match for a command nothing catches", async () => {
    setUserRules([]);

    const { status, body } = await testCommand("ls -la");

    expect(status).toBe(200);
    expect(body).toEqual({ kind: "none" });
  });

  it("lets self-protection win when a rule matches the same command", async () => {
    setUserRules([{ name: "kill anything", pattern: "pkill" }]);

    const { status, body } = await testCommand("pkill node");

    expect(status).toBe(200);
    expect(body.kind).toBe("self_protected");
    expect((body as { reason: string }).reason).toEqual(expect.any(String));
  });

  it("treats an empty command as no match without touching the rule set", async () => {
    setUserRules([{ name: "everything", pattern: "" }]);

    const { status, body } = await testCommand("   ");

    expect(status).toBe(200);
    expect(body).toEqual({ kind: "none" });
  });

  it("rejects a body without a command string", async () => {
    const { status } = await testCommand(42);
    expect(status).toBe(400);
  });
});
