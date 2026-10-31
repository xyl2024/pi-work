import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM,
  MODELS_CONFIG_DIRTY_CLOSE_CONFIRM,
  MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
  selectModelsConfigCloseConfirm,
} from "@/lib/shared/models-config-close";

const CLEAN = { dirty: false, oauthInProgress: false };

describe("selectModelsConfigCloseConfirm", () => {
  it("lets the tab close silently when nothing is unsaved and nothing is in flight", () => {
    expect(selectModelsConfigCloseConfirm(CLEAN)).toBeNull();
  });

  it("asks before closing while an authorization is still running", () => {
    expect(selectModelsConfigCloseConfirm({ ...CLEAN, oauthInProgress: true })).toEqual(
      MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
    );
  });

  it("asks before closing while the draft has unsaved changes", () => {
    expect(selectModelsConfigCloseConfirm({ ...CLEAN, dirty: true })).toEqual(
      MODELS_CONFIG_DIRTY_CLOSE_CONFIRM,
    );
  });

  it("uses one prompt covering both losses when dirty and signing in at once", () => {
    expect(selectModelsConfigCloseConfirm({ dirty: true, oauthInProgress: true })).toEqual(
      MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM,
    );
  });

  it("labels the dirty-close button Discard, not Close", () => {
    expect(MODELS_CONFIG_DIRTY_CLOSE_CONFIRM.confirmLabelKey).toBe("Discard");
    expect(MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM.confirmLabelKey).toBe("Discard");
    expect(MODELS_CONFIG_OAUTH_CLOSE_CONFIRM.confirmLabelKey).toBe("Close");
  });

  it("has Chinese copy for every line of every prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    for (const guard of [
      MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
      MODELS_CONFIG_DIRTY_CLOSE_CONFIRM,
      MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM,
    ]) {
      expect(dict[guard.titleKey]).toBeTruthy();
      expect(dict[guard.descriptionKey]).toBeTruthy();
      expect(dict[guard.confirmLabelKey]).toBeTruthy();
    }
  });
});
