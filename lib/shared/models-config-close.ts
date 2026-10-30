export interface ModelsConfigCloseConditions {
  dirty: boolean;
  oauthInProgress: boolean;
}

export interface ModelsConfigCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

export const MODELS_CONFIG_OAUTH_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Close while signing in?",
  descriptionKey: "The authorization in progress will be cancelled.",
  confirmLabelKey: "Close",
};

export const MODELS_CONFIG_DIRTY_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey: "Your model configuration changes will be lost.",
  confirmLabelKey: "Discard",
};

export const MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM: ModelsConfigCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey:
    "Your model configuration changes will be lost and the authorization in progress will be cancelled.",
  confirmLabelKey: "Discard",
};

export function selectModelsConfigCloseConfirm(
  conditions: ModelsConfigCloseConditions,
): ModelsConfigCloseConfirm | null {
  const { dirty, oauthInProgress } = conditions;
  if (dirty && oauthInProgress) return MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM;
  if (dirty) return MODELS_CONFIG_DIRTY_CLOSE_CONFIRM;
  if (oauthInProgress) return MODELS_CONFIG_OAUTH_CLOSE_CONFIRM;
  return null;
}

export type ModelsConfigOpenAction = "reuse" | "reload";

export interface ModelsConfigOpenState {
  loaded: boolean;
  loading: boolean;
}

export function selectModelsConfigOpenAction(
  state: ModelsConfigOpenState,
): ModelsConfigOpenAction {
  return state.loaded || state.loading ? "reuse" : "reload";
}
