import { describe, expect, it, vi } from "vitest";
import {
  SETTINGS_PAGE_DATA_KEYS,
  createSettingsPageCache,
} from "@/lib/client/settings-page-cache";
import { SETTINGS_SECTION_IDS } from "@/components/settings/registry";
import type { AgentRetryConfig } from "@/lib/shared/agent-settings-types";

const retryConfig: AgentRetryConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: {},
};

describe("settings page data cache", () => {
  it("has nothing to read before the first load", () => {
    const cache = createSettingsPageCache();
    expect(cache.read("retry")).toBeUndefined();
    expect(cache.read("subagent")).toBeUndefined();
    expect(cache.read("append-system")).toBeUndefined();
  });

  it("loads once and serves later loads from the cache", async () => {
    const cache = createSettingsPageCache();
    const loader = vi.fn(async () => retryConfig);

    await expect(cache.fetch("retry", loader)).resolves.toBe(retryConfig);
    expect(cache.read("retry")).toBe(retryConfig);

    await expect(cache.fetch("retry", loader)).resolves.toBe(retryConfig);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight request between concurrent loads", async () => {
    const cache = createSettingsPageCache();
    let release: (value: AgentRetryConfig) => void = () => {};
    const loader = vi.fn(
      () => new Promise<AgentRetryConfig>((resolve) => { release = resolve; }),
    );

    const first = cache.fetch("retry", loader);
    const second = cache.fetch("retry", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    release(retryConfig);
    await expect(first).resolves.toBe(retryConfig);
    await expect(second).resolves.toBe(retryConfig);
    expect(cache.read("retry")).toBe(retryConfig);
  });

  it("refresh bypasses the cached value and replaces it", async () => {
    const cache = createSettingsPageCache();
    cache.write("retry", retryConfig);
    const next: AgentRetryConfig = { ...retryConfig, maxRetries: 5 };
    const loader = vi.fn(async () => next);

    await expect(cache.refresh("retry", loader)).resolves.toBe(next);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.read("retry")).toBe(next);
    await cache.fetch("retry", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("write replaces the cached value without a request", async () => {
    const cache = createSettingsPageCache();
    const loader = vi.fn(async () => retryConfig);
    const next: AgentRetryConfig = { ...retryConfig, enabled: false };

    cache.write("retry", next);
    await expect(cache.fetch("retry", loader)).resolves.toBe(next);
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not cache a failed load, so the next entry retries", async () => {
    const cache = createSettingsPageCache();
    let calls = 0;
    const loader = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return retryConfig;
    });

    await expect(cache.fetch("retry", loader)).rejects.toThrow("boom");
    expect(cache.read("retry")).toBeUndefined();

    await expect(cache.fetch("retry", loader)).resolves.toBe(retryConfig);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a refresh waits for an in-flight load instead of reusing its response", async () => {
    const cache = createSettingsPageCache();
    let releaseFirst: (value: AgentRetryConfig) => void = () => {};
    const first = cache.fetch(
      "retry",
      () => new Promise<AgentRetryConfig>((resolve) => { releaseFirst = resolve; }),
    );
    const fresh: AgentRetryConfig = { ...retryConfig, maxRetries: 7 };
    const loader = vi.fn(async () => fresh);

    const refresh = cache.refresh("retry", loader);
    expect(loader).not.toHaveBeenCalled();

    releaseFirst(retryConfig);
    await expect(refresh).resolves.toBe(fresh);
    await expect(first).resolves.toBe(retryConfig);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.read("retry")).toBe(fresh);
  });

  it("drops a cached value when a refresh fails", async () => {
    const cache = createSettingsPageCache();
    cache.write("retry", retryConfig);

    await expect(
      cache.refresh("retry", async () => { throw new Error("offline"); }),
    ).rejects.toThrow("offline");
    expect(cache.read("retry")).toBeUndefined();
  });

  it("keeps keys independent", async () => {
    const cache = createSettingsPageCache();
    cache.write("subagent", []);
    expect(cache.read("retry")).toBeUndefined();
    expect(cache.read("subagent")).toEqual([]);
  });

  it("caches only registered settings section ids, each exactly once", () => {
    expect(new Set(SETTINGS_PAGE_DATA_KEYS).size).toBe(SETTINGS_PAGE_DATA_KEYS.length);
    for (const key of SETTINGS_PAGE_DATA_KEYS) {
      expect(SETTINGS_SECTION_IDS).toContain(key);
    }
  });
});
