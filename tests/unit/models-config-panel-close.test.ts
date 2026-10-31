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
  updateModelsConfigProvider,
} from "@/lib/client/models-config-panel";
import {
  MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM,
  MODELS_CONFIG_DIRTY_CLOSE_CONFIRM,
  MODELS_CONFIG_OAUTH_CLOSE_CONFIRM,
} from "@/lib/shared/models-config-close";

async function openPanel(): Promise<void> {
  modelsConfigPanel.open();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  modelsConfigPanel.release();
  oauth.setActive(false);
  await openPanel();
});

describe("models config panel close guard", () => {
  it("closes silently when the draft is clean and no login is running", async () => {
    expect(modelsConfigPanel.guard()).toBeNull();
    await expect(modelsConfigPanel.requestClose(async () => true)).resolves.toBe(true);
    expect(modelsConfigPanel.isReleased()).toBe(true);
  });

  it("asks once before discarding an unsaved draft and keeps it when cancelled", async () => {
    updateModelsConfigProvider("openai", { api: "openai-completions" });
    expect(modelsConfigPanel.guard()).toMatchObject(MODELS_CONFIG_DIRTY_CLOSE_CONFIRM);
    await expect(modelsConfigPanel.requestClose(async () => false)).resolves.toBe(false);
    expect(modelsConfigPanel.isReleased()).toBe(false);
    expect(modelsConfigPanel.get().config.providers).toHaveProperty("openai");
  });

  it("asks once while an authorization is running and cancels the login when confirmed", async () => {
    oauth.setActive(true);
    expect(modelsConfigPanel.guard()).toMatchObject(MODELS_CONFIG_OAUTH_CLOSE_CONFIRM);
    await expect(modelsConfigPanel.requestClose(async () => true)).resolves.toBe(true);
    expect(oauth.hasActive()).toBe(false);
    expect(modelsConfigPanel.isReleased()).toBe(true);
  });

  it("merges a dirty draft and a running login into a single prompt", async () => {
    oauth.setActive(true);
    updateModelsConfigProvider("openai", { api: "openai-completions" });
    expect(modelsConfigPanel.guard()).toMatchObject(MODELS_CONFIG_DIRTY_AND_OAUTH_CLOSE_CONFIRM);
    const confirm = vi.fn(async () => true);
    await expect(modelsConfigPanel.requestClose(confirm)).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(oauth.hasActive()).toBe(false);
    expect(modelsConfigPanel.isReleased()).toBe(true);
    expect(modelsConfigPanel.get().config.providers).toEqual({});
  });

  it("does not block a second close with the login it already cancelled", async () => {
    oauth.setActive(true);
    await modelsConfigPanel.requestClose(async () => true);
    await openPanel();
    expect(modelsConfigPanel.guard()).toBeNull();
  });

  it("stops subscribing to the login store once released", async () => {
    expect(oauth.listenerCount()).toBe(1);
    modelsConfigPanel.release();
    expect(oauth.listenerCount()).toBe(0);
    await openPanel();
    expect(oauth.listenerCount()).toBe(1);
  });
});
