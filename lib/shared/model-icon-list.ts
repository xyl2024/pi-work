export const MODEL_ICON_LIST_COLLAPSE_THRESHOLD = 8;

export function shouldCollapseModelIconList(modelCount: number): boolean {
  return Number.isFinite(modelCount) && modelCount > MODEL_ICON_LIST_COLLAPSE_THRESHOLD;
}
