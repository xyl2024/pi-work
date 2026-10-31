import { describe, expect, it } from "vitest";
import { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import type { AgentSessionLike } from "@/lib/server/pi-types";
import {
  parseSubagentConfigSnapshot,
  subagentChildSessionStartOptions,
} from "@/lib/server/subagent-restore";
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from "@/lib/shared/web-tools";

function fakeSession(allTools: string[], source: "user" | "subagent") {
  let active: string[] = [];
  const inner = {
    sessionId: "web-tools-session",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    systemPrompt: "",
    model: undefined,
    agent: { state: { messages: [], tools: [] } },
    sessionManager: { getSessionName: () => null },
    getContextUsage: () => undefined,
    getAllTools: () => allTools.map((name) => ({ name, description: name })),
    getActiveToolNames: () => [...active],
    setActiveToolsByName: (names: string[]) => {
      active = [...names];
    },
    navigateTree: async () => {
      active = [...allTools];
      return { cancelled: false };
    },
  } as unknown as AgentSessionLike;
  return {
    wrapper: new AgentSessionWrapper(inner, source, null),
    active: () => active,
  };
}

describe("subagent-only web tools", () => {
  it("does not activate web tool names that are not registered for a user session", async () => {
    const { wrapper, active } = fakeSession(["read", "bash"], "user");

    wrapper.setToolSelection(["read", WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]);
    await wrapper.send({ type: "navigate_tree", targetId: "entry-1" });

    expect(active()).toEqual(["read"]);
  });

  it("activates web tools in a subagent session whose selection names them", async () => {
    const { wrapper, active } = fakeSession(
      ["read", WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME],
      "subagent",
    );

    wrapper.setToolSelection([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]);
    await wrapper.send({ type: "navigate_tree", targetId: "entry-1" });

    expect(active()).toEqual([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]);
  });

  it("round-trips web tools through the subagent config snapshot into the child start options", () => {
    const snapshot = parseSubagentConfigSnapshot(
      JSON.stringify({
        subagentName: "web_searcher",
        cwd: "/tmp/project",
        model: { provider: "provider", modelId: "model" },
        thinkingLevel: "off",
        permissionMode: "auto_deny",
        tools: [WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, "read", "subagent"],
        systemPrompt: { kind: "override", text: "You search the web." },
        timeoutMs: 60_000,
      }),
    );

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.tools).toEqual([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, "read"]);

    const options = subagentChildSessionStartOptions(snapshot, "parent-session");

    expect(options.allowedToolNames).toEqual([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME, "read"]);
    expect(options.systemPromptOverride).toBe("You search the web.");
  });
});
