import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionLike } from "@/lib/server/pi-types";
import type { SessionEvent } from "@/lib/shared/session-events";
import {
  DEFAULT_BACKGROUND_PERMISSION_MODE,
  isBackgroundPermissionMode,
  isPermissionMode,
  isSessionPermissionMode,
  resolveBackgroundPermissionMode,
} from "@/lib/shared/permission-mode";

const root = mkdtempSync(join(tmpdir(), "pi-work-permission-mode-"));

let evaluateDangerousCommand: typeof import("@/lib/server/dangerous-patterns")["evaluateDangerousCommand"];
let readConfig: typeof import("@/lib/server/config")["readConfig"];
let writeConfig: typeof import("@/lib/server/config")["writeConfig"];
let sidecar: typeof import("@/lib/server/session-permission-mode");
let AgentSessionWrapper: typeof import("@/lib/server/rpc-manager")["AgentSessionWrapper"];

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  ({ evaluateDangerousCommand } = await import("@/lib/server/dangerous-patterns"));
  ({ readConfig, writeConfig } = await import("@/lib/server/config"));
  sidecar = await import("@/lib/server/session-permission-mode");
  ({ AgentSessionWrapper } = await import("@/lib/server/rpc-manager"));
}, 60_000);

beforeEach(() => {
  globalThis.__piWorkConfigCache = undefined;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

function setUserRules(rules: { name: string; pattern: string }[]): void {
  const base = readConfig();
  writeConfig({
    ...base,
    dangerous_patterns: { ...base.dangerous_patterns, rules },
  });
}

describe("evaluateDangerousCommand × permission mode", () => {
  beforeEach(() => {
    setUserRules([{ name: "run-pytest", pattern: "\\bpytest\\b" }]);
  });

  it("hard-blocks self-protection in confirm mode", () => {
    expect(evaluateDangerousCommand("pkill node", "confirm")).toEqual({
      kind: "self_protected",
      reason: expect.any(String),
    });
  });

  it("still hard-blocks self-protection in full access", () => {
    expect(evaluateDangerousCommand("pkill node", "full_access")).toEqual({
      kind: "self_protected",
      reason: expect.any(String),
    });
    expect(evaluateDangerousCommand("shutdown -h now", "full_access").kind).toBe("self_protected");
  });

  it("asks on a user rule in confirm mode and stays quiet in full access", () => {
    expect(evaluateDangerousCommand("pytest -q", "confirm")).toEqual({
      kind: "matched",
      ruleName: "run-pytest",
      source: "user",
    });
    expect(evaluateDangerousCommand("pytest -q", "full_access")).toEqual({ kind: "none" });
  });

  it("asks on a built-in rule in confirm mode and stays quiet in full access", () => {
    expect(evaluateDangerousCommand("rm -rf build", "confirm")).toEqual({
      kind: "matched",
      ruleName: "rm -rf",
      source: "builtin",
    });
    expect(evaluateDangerousCommand("rm -rf build", "full_access")).toEqual({ kind: "none" });
  });

  it("never asks about a command no rule matches, in either mode", () => {
    expect(evaluateDangerousCommand("git status", "confirm")).toEqual({ kind: "none" });
    expect(evaluateDangerousCommand("git status", "full_access")).toEqual({ kind: "none" });
  });

  it("still reports the match in auto-deny so the gate decides", () => {
    expect(evaluateDangerousCommand("pytest -q", "auto_deny")).toEqual({
      kind: "matched",
      ruleName: "run-pytest",
      source: "user",
    });
    expect(evaluateDangerousCommand("rm -rf build", "auto_deny")).toEqual({
      kind: "matched",
      ruleName: "rm -rf",
      source: "builtin",
    });
  });

  it("hard-blocks self-protection in auto-deny too", () => {
    expect(evaluateDangerousCommand("pkill no" + "de", "auto_deny")).toEqual({
      kind: "self_protected",
      reason: expect.any(String),
    });
    expect(evaluateDangerousCommand("shutdown -h now", "auto_deny").kind).toBe("self_protected");
  });

  it("never matches an empty command in auto-deny", () => {
    expect(evaluateDangerousCommand("   ", "auto_deny")).toEqual({ kind: "none" });
  });

  it("defaults to confirm when the mode is omitted", () => {
    expect(evaluateDangerousCommand("pytest -q").kind).toBe("matched");
  });

  it("treats an unknown mode as confirm, never as full access", () => {
    expect(evaluateDangerousCommand("pytest -q", "yolo" as never).kind).toBe("matched");
  });
});

function fakeWrapper(
  sessionId: string,
  source: "user" | "scheduled" | "subagent" = "user",
  permissionMode: "confirm" | "full_access" | "auto_deny" = "confirm",
  background = false,
) {
  const inner = {
    sessionId,
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    systemPrompt: "",
    model: undefined,
    agent: { state: { messages: [] } },
    sessionManager: { getSessionName: () => null },
    getContextUsage: () => undefined,
  } as unknown as AgentSessionLike;
  const wrapper = new AgentSessionWrapper(inner, source, null, permissionMode, { background });
  const events: SessionEvent[] = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, events };
}

const gateRequest = (toolCallId: string, rule: string) => ({
  toolCallId,
  rule,
  command: "rm -rf build",
  what: `the dangerous-command rule "${rule}"`,
  timeoutMs: null,
});

describe("set_permission_mode", () => {
  it("changes the mode, persists it, and announces it", async () => {
    const { wrapper, events } = fakeWrapper("toggling-session-1");
    expect(wrapper.permissionMode).toBe("confirm");

    await expect(wrapper.send({ type: "set_permission_mode", mode: "full_access" })).resolves.toEqual({
      mode: "full_access",
    });

    expect(wrapper.permissionMode).toBe("full_access");
    expect(sidecar.readSessionPermissionMode("toggling-session-1")).toBe("full_access");
    expect(events).toContainEqual({ type: "permission_mode_changed", mode: "full_access" });
  });

  it("rejects an unknown mode and leaves the current mode alone", async () => {
    const { wrapper, events } = fakeWrapper("toggling-session-2");
    await wrapper.send({ type: "set_permission_mode", mode: "full_access" });
    events.length = 0;

    await expect(wrapper.send({ type: "set_permission_mode", mode: "yolo" })).rejects.toThrow(
      /Unknown permission mode/,
    );

    expect(wrapper.permissionMode).toBe("full_access");
    expect(sidecar.readSessionPermissionMode("toggling-session-2")).toBe("full_access");
    expect(events.filter((e) => e.type === "permission_mode_changed")).toEqual([]);
  });

  it("revokes the session memo when leaving full access", async () => {
    const { wrapper } = fakeWrapper("toggling-session-3");

    const first = wrapper.gates.runPermissionGate(gateRequest("call-1", "rm -rf"));
    wrapper.gates.resolvePermission("call-1", "allow_similar");
    await expect(first).resolves.toEqual({ decision: "allow" });
    await expect(wrapper.gates.runPermissionGate(gateRequest("call-2", "rm -rf"))).resolves.toEqual({
      decision: "allow",
    });

    await wrapper.send({ type: "set_permission_mode", mode: "full_access" });
    await wrapper.send({ type: "set_permission_mode", mode: "confirm" });

    const third = wrapper.gates.runPermissionGate(gateRequest("call-3", "rm -rf"));
    expect(wrapper.snapshotPendingGates()).toEqual([
      expect.objectContaining({ type: "permission_request", toolCallId: "call-3" }),
    ]);
    wrapper.gates.resolvePermission("call-3", "deny");
    await expect(third).resolves.toEqual({
      decision: "deny",
      reason: expect.any(String),
    });
  });

  it("keeps an unattended session on its configured mode and never writes the sidecar", async () => {
    const { wrapper, events } = fakeWrapper("scheduled-session-1", "scheduled", "auto_deny", true);
    expect(wrapper.permissionMode).toBe("auto_deny");
    expect(wrapper.isBackgroundSession).toBe(true);

    await expect(wrapper.send({ type: "set_permission_mode", mode: "full_access" })).rejects.toThrow(
      /fixed for an unattended session/,
    );

    expect(wrapper.permissionMode).toBe("auto_deny");
    expect(sidecar.readSessionPermissionMode("scheduled-session-1")).toBe("confirm");
    expect(events.filter((e) => e.type === "permission_mode_changed")).toEqual([]);
  });

  it("neither approves nor denies a gate that is already waiting", async () => {
    const { wrapper } = fakeWrapper("toggling-session-4");
    const pending = wrapper.gates.runPermissionGate(gateRequest("call-1", "rm -rf"));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await wrapper.send({ type: "set_permission_mode", mode: "full_access" });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(wrapper.snapshotPendingGates()).toHaveLength(1);

    await wrapper.send({ type: "set_permission_mode", mode: "confirm" });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(wrapper.snapshotPendingGates()).toHaveLength(1);

    wrapper.gates.resolvePermission("call-1", "allow_once");
    await expect(pending).resolves.toEqual({ decision: "allow" });
  });
});

describe("session permission-mode sidecar", () => {
  it("reads a session that never opted in as confirm", () => {
    expect(sidecar.readSessionPermissionMode("never-set-session")).toBe("confirm");
  });

  it("round-trips both modes", () => {
    expect(sidecar.writeSessionPermissionMode("round-trip-session", "full_access")).toBe(true);
    expect(sidecar.readSessionPermissionMode("round-trip-session")).toBe("full_access");

    expect(sidecar.writeSessionPermissionMode("round-trip-session", "confirm")).toBe(true);
    expect(sidecar.readSessionPermissionMode("round-trip-session")).toBe("confirm");
  });

  it("does not trust an illegal mode value in the file", () => {
    sidecar.writeSessionPermissionMode("broken-value-session", "full_access");
    writeFileSync(
      join(root, "session-permission-mode", "broken-value-session.json"),
      JSON.stringify({ mode: "yolo", updatedAt: new Date().toISOString() }),
      "utf8",
    );

    expect(sidecar.readSessionPermissionMode("broken-value-session")).toBe("confirm");
  });

  it("survives a corrupt file", () => {
    sidecar.writeSessionPermissionMode("corrupt-file-session", "full_access");
    writeFileSync(join(root, "session-permission-mode", "corrupt-file-session.json"), "{ not json", "utf8");

    expect(sidecar.readSessionPermissionMode("corrupt-file-session")).toBe("confirm");
  });

  it("refuses an unsafe session id instead of writing outside the sidecar dir", () => {
    expect(sidecar.writeSessionPermissionMode("../../escape", "full_access")).toBe(false);
    expect(sidecar.readSessionPermissionMode("../../escape")).toBe("confirm");
    expect(existsSync(join(root, "escape.json"))).toBe(false);
  });

  it("reports only the sessions that are not on the default mode", () => {
    sidecar.writeSessionPermissionMode("bulk-full-access", "full_access");
    sidecar.writeSessionPermissionMode("bulk-confirm", "confirm");

    const modes = sidecar.readSessionPermissionModes();
    expect(modes["bulk-full-access"]).toBe("full_access");
    expect(modes["bulk-confirm"]).toBeUndefined();
  });

  it("writes an atomic tmp+rename, leaving no temp files behind", () => {
    sidecar.writeSessionPermissionMode("atomic-write-session", "full_access");
    const entries = readdirSync(join(root, "session-permission-mode"));
    expect(entries.filter((name) => name.includes(".tmp"))).toEqual([]);
    const parsed = JSON.parse(
      readFileSync(join(root, "session-permission-mode", "atomic-write-session.json"), "utf8"),
    ) as { mode?: unknown; updatedAt?: unknown };
    expect(parsed.mode).toBe("full_access");
    expect(typeof parsed.updatedAt).toBe("string");
  });
});

describe("isPermissionMode", () => {
  it("accepts exactly the two modes", () => {
    expect(isPermissionMode("confirm")).toBe(true);
    expect(isPermissionMode("full_access")).toBe(true);
    for (const value of ["", "full access", "FULL_ACCESS", "auto_deny", "yolo", null, undefined, 1, {}]) {
      expect(isPermissionMode(value)).toBe(false);
    }
  });
});

describe("background permission modes", () => {
  it("accepts exactly full access and auto-deny", () => {
    expect(isBackgroundPermissionMode("full_access")).toBe(true);
    expect(isBackgroundPermissionMode("auto_deny")).toBe(true);
    for (const value of ["confirm", "", "full access", "AUTO_DENY", "yolo", null, undefined, 1, {}]) {
      expect(isBackgroundPermissionMode(value)).toBe(false);
    }
  });

  it("falls back to auto-deny for empty, null and unknown values", () => {
    expect(DEFAULT_BACKGROUND_PERMISSION_MODE).toBe("auto_deny");
    for (const value of [undefined, null, "", "confirm", "yolo", 1]) {
      expect(resolveBackgroundPermissionMode(value)).toBe("auto_deny");
    }
    expect(resolveBackgroundPermissionMode("full_access")).toBe("full_access");
  });

  it("treats the runtime mode as the union of the two sets", () => {
    for (const value of ["confirm", "full_access", "auto_deny"]) {
      expect(isSessionPermissionMode(value)).toBe(true);
    }
    for (const value of ["", "yolo", null, 1, {}]) {
      expect(isSessionPermissionMode(value)).toBe(false);
    }
  });
});
