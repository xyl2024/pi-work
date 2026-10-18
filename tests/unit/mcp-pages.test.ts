import { describe, expect, it } from "vitest";
import {
  MCP_LIST_PAGE,
  backMcpPage,
  createMcpPageStack,
  currentMcpPage,
  isMcpListPage,
  mcpPagesAfterDelete,
  mcpPagesAfterSave,
  openMcpEntryPage,
  openMcpPage,
  reconcileMcpPages,
  type McpPage,
} from "@/lib/shared/mcp-pages";

/**
 * The MCP panel's page stack (lib/shared/mcp-pages.ts). Driven as plain data —
 * the store holds the current stack and the panel renders `currentMcpPage`. No
 * React, no DOM, no server.
 */

function entry(uid: string): McpPage {
  return { kind: "entry", uid };
}

describe("createMcpPageStack / currentMcpPage", () => {
  it("starts on the two-file list", () => {
    expect(createMcpPageStack()).toEqual([MCP_LIST_PAGE]);
  });

  it("resolves an empty stack to the list", () => {
    expect(currentMcpPage([])).toEqual(MCP_LIST_PAGE);
  });
});

describe("openMcpPage / openMcpEntryPage", () => {
  it("opens an entry above the list", () => {
    expect(openMcpEntryPage("a")).toEqual([MCP_LIST_PAGE, entry("a")]);
  });

  it("replaces a sibling entry page instead of growing the stack", () => {
    const first = openMcpEntryPage("a");
    const second = openMcpEntryPage("b");
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second).toEqual([MCP_LIST_PAGE, entry("b")]);
  });

  it("returns to the list when asked for the list page", () => {
    expect(openMcpPage(MCP_LIST_PAGE)).toEqual([MCP_LIST_PAGE]);
  });
});

describe("backMcpPage / isMcpListPage", () => {
  it("pops one level", () => {
    expect(backMcpPage([MCP_LIST_PAGE, entry("a")])).toEqual([MCP_LIST_PAGE]);
  });

  it("is a no-op on the list", () => {
    expect(backMcpPage([MCP_LIST_PAGE])).toEqual([MCP_LIST_PAGE]);
    expect(backMcpPage([])).toEqual([MCP_LIST_PAGE]);
  });

  it("reports the list as the root level and an entry page as deeper", () => {
    expect(isMcpListPage([])).toBe(true);
    expect(isMcpListPage([MCP_LIST_PAGE])).toBe(true);
    expect(isMcpListPage([MCP_LIST_PAGE, entry("a")])).toBe(false);
  });
});

describe("save / delete convergence", () => {
  it("draws the stack back to the list after a save", () => {
    expect(mcpPagesAfterSave()).toEqual([MCP_LIST_PAGE]);
  });

  it("draws the stack back to the list after a delete", () => {
    expect(mcpPagesAfterDelete()).toEqual([MCP_LIST_PAGE]);
  });
});

describe("reconcileMcpPages", () => {
  it("keeps an entry page while its draft still exists", () => {
    const pages = openMcpEntryPage("a");
    expect(reconcileMcpPages(pages, ["a", "b"])).toEqual(pages);
  });

  it("falls back to the list when a reload dropped the entry", () => {
    const pages = openMcpEntryPage("gone");
    expect(reconcileMcpPages(pages, ["a"])).toEqual([MCP_LIST_PAGE]);
  });

  it("keeps the list as the list", () => {
    expect(reconcileMcpPages([MCP_LIST_PAGE], [])).toEqual([MCP_LIST_PAGE]);
  });
});
