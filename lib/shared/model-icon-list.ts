/**
 * Collapse rule for a provider detail page's model list — a presentation
 * decision, deliberately kept out of the icon auto-match module. Pure data, no
 * DOM, so the UI stays a thin shell.
 *
 * Above the threshold the list starts collapsed behind a "show all" control so
 * the page is not drowned by rows.
 */
export const MODEL_ICON_LIST_COLLAPSE_THRESHOLD = 8;

/** Whether a provider detail's model list should default to collapsed. */
export function shouldCollapseModelIconList(modelCount: number): boolean {
  return Number.isFinite(modelCount) && modelCount > MODEL_ICON_LIST_COLLAPSE_THRESHOLD;
}
