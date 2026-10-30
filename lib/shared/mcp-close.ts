export interface McpCloseConditions {
  dirty: boolean;
}

export interface McpCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

export const MCP_DIRTY_CLOSE_CONFIRM: McpCloseConfirm = {
  titleKey: "mcp.discardTitle",
  descriptionKey: "mcp.discardBody",
  confirmLabelKey: "mcp.discard",
};

export function selectMcpCloseConfirm(
  conditions: McpCloseConditions,
): McpCloseConfirm | null {
  return conditions.dirty ? MCP_DIRTY_CLOSE_CONFIRM : null;
}

export type McpOpenAction = "reuse" | "show-snapshot" | "reload";

export interface McpOpenState {
  loading: boolean;
  dirty: boolean;
  hasSnapshot: boolean;
}

export function selectMcpOpenAction(state: McpOpenState): McpOpenAction {
  if (state.dirty || state.loading) return "reuse";
  return state.hasSnapshot ? "show-snapshot" : "reload";
}
