import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openTokens,
  setTokensCwd,
  setTokensRange,
  tokensPanel,
} from "@/lib/client/tokens-panel";

function summary() {
  return {
    totals: {
      key: "total",
      calls: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costTotal: 0.1,
      durationMs: 1,
      firstAt: 0,
      lastAt: 0,
    },
    buckets: [],
  };
}

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/workspaces")
      ? { workspaces: [{ cwd: "/project-a" }, { cwd: "/project-b" }] }
      : summary();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function summaryCalls(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/token-audit/summary"));
}

afterEach(() => {
  tokensPanel.release();
  vi.unstubAllGlobals();
});

describe("tokens main view store", () => {
  it("loads the summary once on open and keeps the filters", async () => {
    const fetchMock = stubApi();

    openTokens();
    await vi.waitFor(() => expect(tokensPanel.get().loaded).toBe(true));
    expect(summaryCalls(fetchMock)).toHaveLength(3);

    openTokens();
    expect(summaryCalls(fetchMock)).toHaveLength(3);
    expect(tokensPanel.get().range).toBe("7d");
  });

  it("reloads on a filter change without resetting the store", async () => {
    const fetchMock = stubApi();

    openTokens();
    await vi.waitFor(() => expect(tokensPanel.get().loaded).toBe(true));

    setTokensRange("30d");
    await vi.waitFor(() => expect(summaryCalls(fetchMock)).toHaveLength(6));

    expect(tokensPanel.get().range).toBe("30d");
    expect(tokensPanel.get().cwds).toEqual(["/project-a", "/project-b"]);
    expect(summaryCalls(fetchMock).some((url) => url.includes("range=30d"))).toBe(true);
  });

  it("reloads when the cwd filter changes", async () => {
    const fetchMock = stubApi();

    openTokens();
    await vi.waitFor(() => expect(tokensPanel.get().loaded).toBe(true));

    setTokensCwd("/project-b");
    await vi.waitFor(() => expect(summaryCalls(fetchMock)).toHaveLength(6));

    expect(tokensPanel.get().cwdFilter).toBe("/project-b");
    expect(summaryCalls(fetchMock).some((url) => url.includes("cwd=%2Fproject-b"))).toBe(true);
  });
});
