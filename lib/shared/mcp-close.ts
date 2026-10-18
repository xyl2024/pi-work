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
 *   • the reopen action first shows the last-read snapshot and reconciles it in
 *     the background (ADR-0018 revision), but a clean panel still *checks* disk
 *     on every re-open — `mcp.json` has more than one writer (pi CLI / TUI, a
 *     hand edit), and every save is a read-modify-write that never assumes its
 *     own snapshot is current. What changed is only that the first frame no
 *     longer blocks on that check. A dirty draft (or an in-flight read) reuses
 *     what the store holds and never reconciles over the user's edits.
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
 * draft or a read still in flight), `show-snapshot` the last read while a
 * background reconcile checks the disk, or `reload` from disk when there is no
 * snapshot yet.
 */
export type McpOpenAction = "reuse" | "show-snapshot" | "reload";

/** The store facts the reopen rule reads. */
export interface McpOpenState {
  /** A read is already in flight for this cwd. */
  loading: boolean;
  /** The held draft for this cwd differs from disk. */
  dirty: boolean;
  /** A previous read for this cwd is still held (the snapshot to show). */
  hasSnapshot: boolean;
}

/**
 * The reopen rule. A dirty draft survives a collapse / tab switch (the store
 * keeps it) and is reused untouched; a clean panel with a snapshot shows it
 * immediately and reconciles in the background; only a cwd we have never read
 * blocks on a fresh read.
 */
export function selectMcpOpenAction(state: McpOpenState): McpOpenAction {
  if (state.dirty || state.loading) return "reuse";
  return state.hasSnapshot ? "show-snapshot" : "reload";
}
