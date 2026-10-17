import { describe, expect, it } from "vitest";
import { agentToolDenylist } from "@/lib/server/agent-tool-denylist";

/**
 * Guards the registry denylist `rpc-manager` hands to `createAgentSession`'s
 * `excludeTools`. Two different reasons put a name on it — the platform cannot
 * run it, or the product does not ship it — and both must be composed in, since
 * this list is the only thing standing between an excluded tool and `get_tools`
 * re-listing it. The platform is an explicit argument (ADR-0003 rule 3), so the
 * Windows branch is covered from Linux.
 */
const PLATFORMS = ["win32", "linux", "darwin"];

/** The removed trio (ADR-0015): `bash` covers all three jobs. */
const REMOVED_TOOLS = ["grep", "find", "ls"];

/** Tools the product still ships and the denylist must never touch. */
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
