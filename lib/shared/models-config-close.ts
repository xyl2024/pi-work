/**
 * Close guard + reopen policy for the models-config panel view.
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
 * Two conditions can make a close lossy, and they compose:
 *
 *   • `dirty` — the draft differs from the file on disk. Confirming discards
 *     it (the shell then releases the module store, so the next open re-reads
 *     disk);
 *   • `oauthInProgress` — a subscription authorization is still running.
 *     Confirming cancels it.
 *
 * Both at once gets its own prompt so the copy stays honest about cancelling
 * the authorization, not just dropping the draft. `selectModelsConfigOpenAction`
 * is the other half of the same lifecycle: once the tab has closed the draft is
 * released, and the next open must read disk again.
 */

/** What the close decision reads. */
export interface ModelsConfigCloseConditions {
  /** The draft differs from the file on disk. */
  dirty: boolean;
  /** At least one provider's OAuth authorization is still in flight. */
  oauthInProgress: boolean;
}

/** The confirmation to show before closing the models-config tab. */
export interface ModelsConfigCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  /** Button label for "yes, close and discard". Cancel always keeps the tab. */
  confirmLabelKey: string;
}

/** The confirmation shown when closing would cancel a running authorization. */
export const MODELS_CONFIG_OAUTH_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Close while signing in?",
  descriptionKey: "The authorization in progress will be cancelled.",
  confirmLabelKey: "Close",
};

/** The confirmation shown when closing would drop unsaved edits. */
export const MODELS_CONFIG_DIRTY_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey: "Your model configuration changes will be lost.",
  confirmLabelKey: "Discard",
};

/** Both lossy conditions at once: dropping the draft also stops the login. */
export const MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey:
    "Your model configuration changes will be lost and the authorization in progress will be cancelled.",
  confirmLabelKey: "Discard",
};

/**
 * The confirmation to show before closing the models-config tab, or null when
 * it may close silently. The more specific "dirty + signing in" prompt wins so
 * the copy never hides the cancelled authorization.
 */
export function selectModelsConfigCloseConfirm(
  conditions: ModelsConfigCloseConditions,
): ModelsConfigCloseConfirm | null {
  const { dirty, oauthInProgress } = conditions;
  if (dirty && oauthInProgress) return MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM;
  if (dirty) return MODELS_CONFIG_DIRTY_CLOSE_CONFIRM;
  if (oauthInProgress) return MODELS_CONFIG_OAUTH_CLOSE_CONFIRM;
  return null;
}

/**
 * What the next open of the panel should do with the config: `reuse` a draft
 * that is still held (the tab stayed open, only the body unmounted), or
 * `reload` from disk (the tab closed and released the draft).
 */
export type ModelsConfigOpenAction = "reuse" | "reload";

/** The store facts the reopen rule reads. */
export interface ModelsConfigOpenState {
  /** A draft exists (a previous read completed). */
  loaded: boolean;
  /** A read is already in flight. */
  loading: boolean;
}

/**
 * The reopen rule. A draft held in the module store survives a collapse / tab
 * switch, so `ensureModelsConfigLoaded` reuses it; only after the tab closes
 * (which releases the store) does the next open read disk again. A read already
 * in flight is reuse too, so two mounts never race two loads.
 */
export function selectModelsConfigOpenAction(
  state: ModelsConfigOpenState,
): ModelsConfigOpenAction {
  return state.loaded || state.loading ? "reuse" : "reload";
}
