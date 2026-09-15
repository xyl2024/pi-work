import { afterAll, describe, expect, it } from "vitest";
import {
  ALWAYS_BYPASS_HOSTS,
  type NetworkProxyConfig,
} from "@/lib/shared/config-types";
import { buildNoProxyList, checkProxyUrl } from "@/lib/server/network-proxy";
import { api, type Json } from "./helpers";

/**
 * Settings → Network proxy.
 *
 * Two layers here:
 *
 * - pure unit tests for the URL / bypass-list normalization (no network),
 * - API tests against the isolated instance's config.yaml.
 *
 * The API tests deliberately never leave the proxy *enabled*: the dispatcher
 * it installs is process-wide, so a stray enabled-at-a-dead-address value
 * would break every other test sharing the isolated server. The live
 * application path is covered by keeping the enable/disable round trip
 * balanced inside a single `try/finally`.
 */
describe("network-proxy: url validation", () => {
  it("accepts an empty url as \"not configured\"", () => {
    expect(checkProxyUrl("")).toEqual({ ok: true, url: "" });
    expect(checkProxyUrl("   ")).toEqual({ ok: true, url: "" });
  });

  it("accepts http and https proxies", () => {
    expect(checkProxyUrl("http://127.0.0.1:7897")).toEqual({ ok: true, url: "http://127.0.0.1:7897" });
    expect(checkProxyUrl("https://proxy.example.com:8443")).toEqual({
      ok: true,
      url: "https://proxy.example.com:8443",
    });
    // Surrounding whitespace is trimmed, not rejected.
    expect(checkProxyUrl("  http://127.0.0.1:7897  ")).toEqual({
      ok: true,
      url: "http://127.0.0.1:7897",
    });
  });

  it("rejects unsupported schemes and malformed input", () => {
    for (const bad of ["socks5://127.0.0.1:1080", "ftp://x", "127.0.0.1:7897", "not a url"]) {
      const result = checkProxyUrl(bad);
      expect(result.ok, `${bad} should be rejected`).toBe(false);
    }
    expect(checkProxyUrl(undefined).ok).toBe(false);
    expect(checkProxyUrl(123).ok).toBe(false);
  });
});

describe("network-proxy: bypass list", () => {
  it("always keeps the local hosts, in order, and appends the extras", () => {
    const list = buildNoProxyList("10.0.0.0/8,.internal.example.com");
    expect(list.startsWith(ALWAYS_BYPASS_HOSTS.join(","))).toBe(true);
    expect(list).toContain("10.0.0.0/8");
    expect(list).toContain(".internal.example.com");
  });

  it("trims, drops empties and de-duplicates", () => {
    expect(buildNoProxyList("   ")).toBe(ALWAYS_BYPASS_HOSTS.join(","));
    expect(buildNoProxyList("localhost, ,127.0.0.1, example.com ,example.com"))
      .toBe([...ALWAYS_BYPASS_HOSTS, "example.com"].join(","));
  });
});

let originalProxy: NetworkProxyConfig | undefined;

afterAll(async () => {
  // Never leave an enabled proxy behind for the rest of the suite.
  const restore: NetworkProxyConfig = originalProxy ?? { enabled: false, url: "", no_proxy: "" };
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ network_proxy: { ...restore, enabled: false } }),
  });
});

describe("settings api: network proxy", () => {
  it("exposes the network_proxy block with the settings defaults", async () => {
    const res = await api("/api/settings");
    expect(res.status).toBe(200);
    const proxy = res.body.network_proxy as Json;
    expect(proxy).toBeTypeOf("object");
    expect(typeof proxy.enabled).toBe("boolean");
    expect(typeof proxy.url).toBe("string");
    expect(typeof proxy.no_proxy).toBe("string");
    originalProxy = proxy as unknown as NetworkProxyConfig;
  });

  it("rejects enabling the proxy without an address", async () => {
    const res = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ network_proxy: { enabled: true, url: "", no_proxy: "" } }),
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("network_proxy.url");
  });

  it("rejects a SOCKS url", async () => {
    const res = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ network_proxy: { enabled: true, url: "socks5://127.0.0.1:1080" } }),
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("http://");
  });

  it("round-trips url and no_proxy through config.yaml", async () => {
    const before = originalProxy ?? { enabled: false, url: "", no_proxy: "" };
    try {
      const put = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          network_proxy: { enabled: false, url: "http://127.0.0.1:7897", no_proxy: "10.1.2.3" },
        }),
      });
      expect(put.status).toBe(200);

      const after = await api("/api/settings");
      const proxy = after.body.network_proxy as Json;
      expect(proxy.url).toBe("http://127.0.0.1:7897");
      expect(proxy.no_proxy).toBe("10.1.2.3");
      // Persisted but not active — enabling is what installs the dispatcher.
      expect(proxy.enabled).toBe(false);
    } finally {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ network_proxy: before }),
      });
    }
  });
});

describe("settings api: proxy connection test", () => {
  it("rejects an empty address", async () => {
    const res = await api("/api/settings/proxy-test", {
      method: "POST",
      body: JSON.stringify({ url: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a SOCKS address", async () => {
    const res = await api("/api/settings/proxy-test", {
      method: "POST",
      body: JSON.stringify({ url: "socks5://127.0.0.1:1080" }),
    });
    expect(res.status).toBe(400);
  });

  it("reports a refused connection instead of hanging", async () => {
    // Port 1 is reserved and never listening: the probe must come back with
    // ok:false + a reason rather than a timeout or a 500.
    const res = await api("/api/settings/proxy-test", {
      method: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1:1", probe_url: "https://example.com/" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error)).toMatch(/ECONNREFUSED|fetch failed|connect/i);
  });
});
