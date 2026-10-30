export type McpPage = { kind: "list" } | { kind: "entry"; uid: string };

export const MCP_LIST_PAGE: McpPage = { kind: "list" };

export function createMcpPageStack(): McpPage[] {
  return [MCP_LIST_PAGE];
}

export function currentMcpPage(pages: readonly McpPage[]): McpPage {
  return pages.length > 0 ? pages[pages.length - 1] : MCP_LIST_PAGE;
}

export function openMcpPage(page: McpPage): McpPage[] {
  if (page.kind === "list") return createMcpPageStack();
  return [MCP_LIST_PAGE, page];
}

export function openMcpEntryPage(uid: string): McpPage[] {
  return openMcpPage({ kind: "entry", uid });
}

export function backMcpPage(pages: readonly McpPage[]): McpPage[] {
  if (pages.length <= 1) return createMcpPageStack();
  return pages.slice(0, -1);
}

export function isMcpListPage(pages: readonly McpPage[]): boolean {
  return pages.length <= 1 || currentMcpPage(pages).kind === "list";
}

export function mcpPagesAfterSave(): McpPage[] {
  return createMcpPageStack();
}

export function mcpPagesAfterDelete(): McpPage[] {
  return createMcpPageStack();
}

export function reconcileMcpPages(
  pages: readonly McpPage[],
  entryUids: readonly string[],
): McpPage[] {
  const page = currentMcpPage(pages);
  if (page.kind === "entry" && !entryUids.includes(page.uid)) return createMcpPageStack();
  return pages.length > 0 ? [...pages] : createMcpPageStack();
}
