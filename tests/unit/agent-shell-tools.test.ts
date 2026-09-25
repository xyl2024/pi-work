import { describe, expect, it } from "vitest";
import {
  AGENT_SHELL_TOOL_NAMES,
  agentShellTools,
  unavailableAgentShellTools,
} from "@/lib/shared/agent-shell-tools";

/**
 * The platform rule behind "which shells does the agent get". Two consumers
 * depend on it: the SDK registry denylist `rpc-manager` hands to
 * `createAgentSession` (so a tool the platform cannot run never reaches the
 * model), and the read-only tool set of the subagent profiles. The platform is
 * an explicit argument (ADR-0003 rule 3), so the Windows branch is covered
 * from Linux.
 */
const PLATFORMS = ["win32", "linux", "darwin"];

describe("agent shell tools per platform", () => {
  it("gives Windows both shells: Git Bash and PowerShell", () => {
    expect(agentShellTools("win32")).toEqual(["bash", "powershell"]);
  });

  it("gives every other platform bash only", () => {
    for (const platform of ["linux", "darwin", "freebsd"]) {
      expect(agentShellTools(platform)).toEqual(["bash"]);
    }
  });

  it("denies exactly the shells the platform does not have", () => {
    expect(unavailableAgentShellTools("win32")).toEqual([]);
    expect(unavailableAgentShellTools("linux")).toEqual(["powershell"]);
    expect(unavailableAgentShellTools("darwin")).toEqual(["powershell"]);
  });

  it("never denies bash, on any platform (D5: the bash tool stays)", () => {
    for (const platform of PLATFORMS) {
      expect(agentShellTools(platform)).toContain("bash");
      expect(unavailableAgentShellTools(platform)).not.toContain("bash");
    }
  });

  it("builds the denylist out of the same vocabulary as the availability list", () => {
    for (const platform of PLATFORMS) {
      expect([...agentShellTools(platform), ...unavailableAgentShellTools(platform)].sort()).toEqual(
        [...AGENT_SHELL_TOOL_NAMES].sort(),
      );
    }
  });
});
