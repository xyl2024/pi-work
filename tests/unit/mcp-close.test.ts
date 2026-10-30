import { describe, expect, it } from "vitest";
import {
  MCP_DIRTY_CLOSE_CONFIRM,
  selectMcpCloseConfirm,
  selectMcpOpenAction,
  type McpOpenState,
} from "@/lib/shared/mcp-close";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";

function openState(partial: Partial<McpOpenState>): McpOpenState {
  return { loading: false, dirty: false, hasSnapshot: false, ...partial };
}

describe("selectMcpCloseConfirm", () => {
  it("lets the tab close silently when no working directory is dirty", () => {
    expect(selectMcpCloseConfirm({ dirty: false })).toBeNull();
  });

  it("asks once when any working directory holds unsaved changes", () => {
    expect(selectMcpCloseConfirm({ dirty: true })).toEqual(MCP_DIRTY_CLOSE_CONFIRM);
  });

  it("points at the existing discard copy keys", () => {
    expect(MCP_DIRTY_CLOSE_CONFIRM.titleKey).toBe("mcp.discardTitle");
    expect(MCP_DIRTY_CLOSE_CONFIRM.descriptionKey).toBe("mcp.discardBody");
    expect(MCP_DIRTY_CLOSE_CONFIRM.confirmLabelKey).toBe("mcp.discard");
  });

  it("has Chinese copy for every line of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[MCP_DIRTY_CLOSE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[MCP_DIRTY_CLOSE_CONFIRM.descriptionKey]).toBeTruthy();
    expect(dict[MCP_DIRTY_CLOSE_CONFIRM.confirmLabelKey]).toBeTruthy();
  });
});

describe("selectMcpOpenAction", () => {
  it("reloads from disk when there is no snapshot yet", () => {
    expect(selectMcpOpenAction(openState({}))).toBe("reload");
    expect(selectMcpOpenAction(openState({ loading: false, dirty: false, hasSnapshot: false }))).toBe("reload");
  });

  it("shows the last snapshot first and checks disk in the background", () => {
    expect(selectMcpOpenAction(openState({ hasSnapshot: true }))).toBe("show-snapshot");
  });

  it("reuses a draft that is still dirty — never reconciles over the user's edits", () => {
    expect(selectMcpOpenAction(openState({ dirty: true }))).toBe("reuse");
    expect(selectMcpOpenAction(openState({ dirty: true, hasSnapshot: true }))).toBe("reuse");
  });

  it("reuses a read that is already in flight, so two mounts never race", () => {
    expect(selectMcpOpenAction(openState({ loading: true }))).toBe("reuse");
    expect(selectMcpOpenAction(openState({ loading: true, dirty: true }))).toBe("reuse");
    expect(selectMcpOpenAction(openState({ loading: true, hasSnapshot: true }))).toBe("reuse");
  });
});
