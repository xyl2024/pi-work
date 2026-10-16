import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
  selectModelsConfigCloseConfirm,
} from "@/lib/shared/models-config-close";

/**
 * The models-config panel's close guard (lib/shared/models-config-close.ts):
 * whether closing the panel tab may lose something, and which confirmation to
 * put on screen. Driven as plain data, no browser — the shell is the only
 * caller and it maps the returned i18n keys through `t()`.
 */

describe("selectModelsConfigCloseConfirm", () => {
  it("asks before closing while an authorization is still running", () => {
    expect(selectModelsConfigCloseConfirm({ oauthInProgress: true })).toEqual(
      MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
    );
  });

  it("lets the tab close silently when nothing is in flight", () => {
    expect(selectModelsConfigCloseConfirm({ oauthInProgress: false })).toBeNull();
  });

  it("has Chinese copy for both lines of the prompt", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    expect(dict[MODELS_CONFIG_OAUTH_CLOSE_CONFIRM.titleKey]).toBeTruthy();
    expect(dict[MODELS_CONFIG_OAUTH_CLOSE_CONFIRM.descriptionKey]).toBeTruthy();
  });
});
