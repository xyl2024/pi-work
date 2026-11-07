import { beforeEach, describe, expect, it, vi } from "vitest";

const oauth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let active = false;
  return {
    hasActive: () => active,
    setActive(next: boolean) {
      active = next;
      for (const listener of listeners) listener();
    },
    cancel() {
      active = false;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
  };
});

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

vi.mock("@/lib/client/models-config-io", () => ({
  fetchApiKeyProviders: vi.fn(async () => []),
  fetchOAuthProviders: vi.fn(async () => []),
  fetchModelsConfigPayload: vi.fn(async () => ({ providers: {} })),
  putModelsConfig: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/client/oauth-login-store", () => ({
  hasActiveOAuthLogin: () => oauth.hasActive(),
  cancelActiveOAuthLogins: () => oauth.cancel(),
  subscribeOAuthLogins: (listener: () => void) => oauth.subscribe(listener),
  getOAuthLoginState: () => ({ phase: "idle" }),
}));

import {
  modelsConfigPanel,
  openModelsConfigModel,
  selectModelsConfigProvider,
  updateModelsConfigProvider,
} from "@/lib/client/models-config-panel";
import { requestMainViewLeave, setMainViewLeaveConfirm } from "@/lib/client/main-view-leave";
import { MAIN_VIEW_LEAVE_CONFIRM, MAIN_VIEW_LEAVE_CONFIRM_WITH_CHANGES } from "@/lib/shared/main-view-leave";

function QUANTIFIED_CONFIRM(n: number) {
  return { ...MAIN_VIEW_LEAVE_CONFIRM_WITH_CHANGES, params: { n } };
}

async function openPanel(): Promise<void> {
  modelsConfigPanel.open();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  modelsConfigPanel.release();
  oauth.setActive(false);
  setMainViewLeaveConfirm(null);
  await openPanel();
});

describe("models config leave guard", () => {
  it("leaves silently when the draft is clean and no login is running", async () => {
    const confirm = vi.fn(async () => true);
    setMainViewLeaveConfirm(confirm);

    await expect(
      requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks once before discarding a dirty draft and keeps it when cancelled", async () => {
    const confirm = vi.fn<(confirm: unknown) => Promise<boolean>>(async () => false);
    setMainViewLeaveConfirm(confirm);
    selectModelsConfigProvider("openai");
    updateModelsConfigProvider("openai", { api: "openai-completions" });

    await expect(
      requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" }),
    ).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(QUANTIFIED_CONFIRM(1));
    expect(modelsConfigPanel.get().config.providers).toHaveProperty("openai");
  });

  it("asks the same single question for leaving and for switching to another main view", async () => {
    selectModelsConfigProvider("openai");
    updateModelsConfigProvider("openai", { api: "openai-completions" });
    const confirm = vi.fn<(confirm: unknown) => Promise<boolean>>(async () => true);
    setMainViewLeaveConfirm(confirm);

    await requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" });
    updateModelsConfigProvider("openai", { api: "openai-completions" });
    await requestMainViewLeave({ view: "modelsConfig", intent: "switch_main_view" });

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0]).toMatchObject(QUANTIFIED_CONFIRM(1));
    expect(confirm.mock.calls[1][0]).toMatchObject(QUANTIFIED_CONFIRM(1));
  });

  it("discards the dirty draft after confirming", async () => {
    setMainViewLeaveConfirm(async () => true);
    openModelsConfigModel("openai", 0);
    updateModelsConfigProvider("openai", { api: "openai-completions" });

    await requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" });

    expect(modelsConfigPanel.get().config.providers).toEqual({});
    expect(modelsConfigPanel.pages()).toEqual([{ kind: "root" }]);
    expect(modelsConfigPanel.get().selectedProvider).toBe("openai");
  });

  it("asks while an authorization is running and cancels the login when confirmed", async () => {
    oauth.setActive(true);
    const confirm = vi.fn(async () => true);
    setMainViewLeaveConfirm(confirm);

    await expect(
      requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" }),
    ).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(oauth.hasActive()).toBe(false);
  });

  it("never asks when the user only backs out of a form page", async () => {
    const confirm = vi.fn(async () => true);
    setMainViewLeaveConfirm(confirm);
    updateModelsConfigProvider("openai", { api: "openai-completions" });
    openModelsConfigModel("openai", 0);

    await requestMainViewLeave({ view: "modelsConfig", intent: "back_to_browse" });

    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits when backing out of a form page", () => {
    openModelsConfigModel("openai", 0);
    updateModelsConfigProvider("openai", { api: "openai-completions" });

    modelsConfigPanel.back();

    expect(modelsConfigPanel.pages()).toEqual([{ kind: "root" }]);
    expect(modelsConfigPanel.get().config.providers).toHaveProperty("openai");
  });
});

describe("models config leave guard change count", () => {
  it("tailors the confirmation to the number of changed providers", async () => {
    modelsConfigPanel.patch({ config: { providers: { alpha: { api: "anthropic" }, beta: { api: "anthropic" } } } });
    updateModelsConfigProvider("alpha", { api: "anthropic", models: [{ id: "a-1" }] });
    updateModelsConfigProvider("beta", { api: "anthropic", models: [{ id: "b-1" }] });
    const confirm = vi.fn<(confirm: unknown) => Promise<boolean>>(async () => false);
    setMainViewLeaveConfirm(confirm);

    await requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" });

    expect(confirm.mock.calls[0][0]).toMatchObject({ params: { n: 2 } });
  });

  it("keeps the generic wording while an authorization is running with a clean draft", async () => {
    oauth.setActive(true);
    const confirm = vi.fn<(confirm: unknown) => Promise<boolean>>(async () => false);
    setMainViewLeaveConfirm(confirm);

    await requestMainViewLeave({ view: "modelsConfig", intent: "leave_main_view" });

    expect(confirm).toHaveBeenCalledWith(MAIN_VIEW_LEAVE_CONFIRM);
  });
});
