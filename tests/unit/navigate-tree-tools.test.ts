import { describe, expect, it } from "vitest";
import { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import type { AgentSessionLike } from "@/lib/server/pi-types";

const SELECTED = ["read", "bash", "edit", "write", "codemode", "subagent", "celebrate"];
const ALL = [...SELECTED, "ask_user_questions", "pi_work_call"];

function fakeSession() {
  let active = [...SELECTED];
  const inner = {
    sessionId: "navigate-tree-session",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    systemPrompt: "",
    model: undefined,
    agent: { state: { messages: [], tools: [] } },
    sessionManager: { getSessionName: () => null },
    getContextUsage: () => undefined,
    getAllTools: () => ALL.map((name) => ({ name, description: name })),
    getActiveToolNames: () => [...active],
    setActiveToolsByName: (names: string[]) => {
      active = [...names];
    },
    navigateTree: async () => {
      active = [...ALL];
      return { cancelled: false };
    },
  } as unknown as AgentSessionLike;
  return { wrapper: new AgentSessionWrapper(inner, "user", null), active: () => active };
}

describe("navigate_tree tool selection", () => {
  it("re-applies the session selection after the SDK restores tools from the branch", async () => {
    const { wrapper, active } = fakeSession();
    wrapper.setToolSelection([...SELECTED]);

    await wrapper.send({ type: "navigate_tree", targetId: "entry-1" });

    expect(active()).toEqual(SELECTED);
  });
});
