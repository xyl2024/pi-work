/**
 * Close guard + reopen policy for the MCP panel view.
 *
 * The panel tab's × lives in the shell's tab strip, but only the panel knows
 * whether closing it would throw something away. This module is that one
 * question, asked the way the models-config / skills guards ask it: pass the
 * conditions, get back the confirmation to show, or null when the tab may close
 * without asking.
 *
 * Two things are intentionally different from the models-config sibling, and
 * ADR-0018 records why:
 *
 *   • the close condition is the **expanded** "any working directory has a dirty
 *     draft" predicate, not "the current draft is dirty". Closing the tab
 *     releases the whole bucket map, so a draft parked while the user looked at
 *     another session is lost too. The badge reads the same predicate — one
 *     source of truth, never two copies.
 *   • the reopen action is `reload` when the panel is clean, even though a
 *     previous read completed. `mcp.json` has more than one writer (pi CLI /
 *     TUI, a hand edit), and every save is a read-modify-write that never
 *     assumes its own snapshot is current — so the display half must not assume
 *     either. Only a dirty draft (or an in-flight read) reuses what the store
 *     holds.
 *
 * Pure — no React / DOM / server imports — so the decisions are driven from
 * `tests/unit`. The shell maps the returned i18n keys through `t()`.
 */

/** What the close decision reads. */
export interface McpCloseConditions {
  /** Any working directory holds a draft that differs from disk. */
  dirty: boolean;
}

/** The confirmation to show before closing the MCP tab. */
export interface McpCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  /** Button label for "yes, close and discard". Cancel always keeps the tab. */
  confirmLabelKey: string;
}

/** Shown when closing would drop unsaved `mcp.json` edits. */
export const MCP_DIRTY_CLOSE_CONFIRM: McpCloseConfirm = {
  titleKey: "mcp.discardTitle",
  descriptionKey: "mcp.discardBody",
  confirmLabelKey: "mcp.discard",
};

/**
 * The confirmation to show before closing the MCP tab, or null when it may
 * close silently. Only unsaved changes make the close lossy.
 */
export function selectMcpCloseConfirm(
  conditions: McpCloseConditions,
): McpCloseConfirm | null {
  return conditions.dirty ? MCP_DIRTY_CLOSE_CONFIRM : null;
}

/**
 * What the next open of the panel should do: `reuse` the held draft (a dirty
 * draft or a read still in flight), or `reload` from disk (the clean case — the
 * file may have changed under us since we last looked).
 */
export type McpOpenAction = "reuse" | "reload";

/** The store facts the reopen rule reads. */
export interface McpOpenState {
  /** A read is already in flight for this cwd. */
  loading: boolean;
  /** The held draft for this cwd differs from disk. */
  dirty: boolean;
}

/**
 * The reopen rule. A dirty draft survives a collapse / tab switch (the store
 * keeps it) and is reused; a clean panel re-reads, because `mcp.json` can be
 * edited by pi itself between two looks and stale content would be a lie.
 */
export function selectMcpOpenAction(state: McpOpenState): McpOpenAction {
  return state.dirty || state.loading ? "reuse" : "reload";
}
