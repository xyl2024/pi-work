import { describe, expect, it } from "vitest";
import { agentToolDenylist } from "@/lib/server/agent-tool-denylist";

const PLATFORMS = ["win32", "linux", "darwin"];

const REMOVED_TOOLS = ["grep", "find", "ls"];

const KEPT_TOOLS = ["read", "bash", "edit", "write"];

describe("agent tool denylist", () => {
  it("denies the removed search-and-list trio on every platform", () => {
    for (const platform of PLATFORMS) {
      for (const tool of REMOVED_TOOLS) {
        expect(agentToolDenylist(platform)).toContain(tool);
      }
    }
  });

  it("never denies a tool the product still ships", () => {
    for (const platform of PLATFORMS) {
      for (const tool of KEPT_TOOLS) {
        expect(agentToolDenylist(platform)).not.toContain(tool);
      }
    }
  });

  it("keeps the platform rule for shells: PowerShell is denied off Windows only", () => {
    expect(agentToolDenylist("win32")).not.toContain("powershell");
    for (const platform of ["linux", "darwin"]) {
      expect(agentToolDenylist(platform)).toContain("powershell");
    }
  });

  it("has no duplicates", () => {
    for (const platform of PLATFORMS) {
      const denylist = agentToolDenylist(platform);
      expect(new Set(denylist).size).toBe(denylist.length);
    }
  });
});
