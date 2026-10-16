/**
 * Close guard for the models-config panel view.
 *
 * The panel tab's × lives in the shell's tab strip, but only the panel itself
 * knows whether closing it would throw something away. This module is that
 * one question, asked the way the settings modal asks it
 * (`lib/shared/settings-unsaved.ts`): the caller passes the conditions and
 * gets back the confirmation to show, or null when the tab may close without
 * asking.
 *
 * Pure — no React / DOM / server imports — so the decision is driven from
 * `tests/unit`. The shell maps the returned i18n keys through `t()`; the
 * confirmation strings stay out of here for the same reason every other
 * selector returns a key.
 *
 * Today the only condition is a running subscription authorization. The shape
 * is deliberately a conditions object rather than a boolean so the dirty-draft
 * condition can join it without changing every caller.
 */

/** What the close decision reads. */
export interface ModelsConfigCloseConditions {
  /** At least one provider's OAuth authorization is still in flight. */
  oauthInProgress: boolean;
}

/** The confirmation shown when closing would cancel a running authorization. */
export const MODELS_CONFIG_OAUTH_CLOSE_CONFIRM = {
  titleKey: "Close while signing in?",
  descriptionKey: "The authorization in progress will be cancelled.",
} as const;

/**
 * The confirmation to show before closing the models-config tab, or null when
 * it may close silently.
 */
export function selectModelsConfigCloseConfirm(
  conditions: ModelsConfigCloseConditions,
): { titleKey: string; descriptionKey: string } | null {
  if (conditions.oauthInProgress) return MODELS_CONFIG_OAUTH_CLOSE_CONFIRM;
  return null;
}
