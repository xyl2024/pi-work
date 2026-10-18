/**
 * Page stack for the MCP panel view.
 *
 * The panel navigates in levels instead of stacking overlays inside a
 * one-third-wide strip. There are exactly two levels:
 *
 *   0. list  — both `mcp.json` files, one section each;
 *   1. entry — one server's form / raw JSON, carrying its draft uid.
 *
 * The entry page carries its context (the draft uid) instead of reading it from
 * the mount, so a tab switch that remounts the view rebuilds the same page. The
 * stack is bounded: opening another entry replaces the previous one rather than
 * growing, and "add server" pushes an entry page exactly like clicking a row
 * does. This module owns the rules so they can be driven from `tests/unit`
 * without a browser — `lib/client/mcp-store.ts` holds the current stack and the
 * panel renders `currentMcpPage`.
 *
 * Two convergence rules ride on top of push/back: a successful save draws the
 * stack back to the list, and a delete must never leave the panel sitting on an
 * entry that no longer exists (the store reconciles after every reload).
 */

/** One level of the panel's navigation. */
export type McpPage = { kind: "list" } | { kind: "entry"; uid: string };

/** The two-file list — the bottom of every stack. */
export const MCP_LIST_PAGE: McpPage = { kind: "list" };

/** A fresh stack, sitting on the list. */
export function createMcpPageStack(): McpPage[] {
  return [MCP_LIST_PAGE];
}

/** The page the panel renders: the top of the stack, the list when it is empty. */
export function currentMcpPage(pages: readonly McpPage[]): McpPage {
  return pages.length > 0 ? pages[pages.length - 1] : MCP_LIST_PAGE;
}

/** Enter a page, replacing whatever sibling sat at the same level. */
export function openMcpPage(page: McpPage): McpPage[] {
  if (page.kind === "list") return createMcpPageStack();
  return [MCP_LIST_PAGE, page];
}

/** Open one draft entry's page. */
export function openMcpEntryPage(uid: string): McpPage[] {
  return openMcpPage({ kind: "entry", uid });
}

/** Pop one level. The list is a floor: backing off it is a no-op. */
export function backMcpPage(pages: readonly McpPage[]): McpPage[] {
  if (pages.length <= 1) return createMcpPageStack();
  return pages.slice(0, -1);
}

/** Whether the stack is sitting on the list, i.e. an Escape cannot pop a level. */
export function isMcpListPage(pages: readonly McpPage[]): boolean {
  return pages.length <= 1 || currentMcpPage(pages).kind === "list";
}

/** Where a successful save lands: back on the list. */
export function mcpPagesAfterSave(): McpPage[] {
  return createMcpPageStack();
}

/** Where a delete lands: back on the list, with the deleted entry gone. */
export function mcpPagesAfterDelete(): McpPage[] {
  return createMcpPageStack();
}

/**
 * Keep an entry page only while its draft still exists. A reload can drop the
 * entry the page was opened for (another writer removed it), and a stale uid
 * would otherwise leave the panel on a page with nothing to render.
 */
export function reconcileMcpPages(
  pages: readonly McpPage[],
  entryUids: readonly string[],
): McpPage[] {
  const page = currentMcpPage(pages);
  if (page.kind === "entry" && !entryUids.includes(page.uid)) return createMcpPageStack();
  return pages.length > 0 ? [...pages] : createMcpPageStack();
}
