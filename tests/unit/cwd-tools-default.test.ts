import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSandbox } from "./sandbox";
import { DEFAULT_CWD_TOOL_NAMES } from "@/lib/shared/tool-selection";

describe("cwd default tool set", () => {
  it("opens only the core four tools when the cwd has no stored selection", async () => {
    const sandbox = createSandbox("pi-work-cwd-tools-default-");
    vi.resetModules();
    const { resolveCwdToolSelection } = await import("@/lib/server/cwd-tools-config");
    const cwd = join(sandbox.root, "project");
    mkdirSync(cwd, { recursive: true });

    expect(DEFAULT_CWD_TOOL_NAMES).toEqual(["read", "write", "edit", "bash"]);
    expect(resolveCwdToolSelection(cwd)).toEqual(["read", "write", "edit", "bash"]);
  });

  it("keeps an explicit selection, including no tools at all", async () => {
    const sandbox = createSandbox("pi-work-cwd-tools-explicit-");
    vi.resetModules();
    const { resolveCwdToolSelection, writeCwdToolSelection } = await import("@/lib/server/cwd-tools-config");
    const cwd = join(sandbox.root, "project");
    mkdirSync(cwd, { recursive: true });

    writeCwdToolSelection(cwd, ["read", "memory"]);
    expect(resolveCwdToolSelection(cwd)).toEqual(["read", "memory"]);

    writeCwdToolSelection(cwd, []);
    expect(resolveCwdToolSelection(cwd)).toEqual([]);
  });

  it("keeps an explicit all selection", async () => {
    const sandbox = createSandbox("pi-work-cwd-tools-all-");
    vi.resetModules();
    const { resolveCwdToolSelection, writeCwdToolSelection } = await import("@/lib/server/cwd-tools-config");
    const cwd = join(sandbox.root, "project");
    mkdirSync(cwd, { recursive: true });

    writeCwdToolSelection(cwd, "all");
    expect(resolveCwdToolSelection(cwd)).toBe("all");
  });
});
