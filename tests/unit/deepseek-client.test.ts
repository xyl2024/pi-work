import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekClient,
  DEEPSEEK_FETCH_PATH,
  DEEPSEEK_MISSING_KEY_ERROR,
  DEEPSEEK_SEARCH_PATH,
} from "@/lib/server/deepseek/client";

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("DeepSeek client", () => {
  it("returns a readable error without calling the network when no key is configured", async () => {
    const fetchMock = vi.fn();
    const client = createDeepSeekClient({
      baseUrl: "http://deepseek.test",
      apiKey: null,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.search({ query: "pi" });

    expect(result).toEqual({ ok: false, error: DEEPSEEK_MISSING_KEY_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to status and a bounded body summary", async () => {
    const client = createDeepSeekClient({
      baseUrl: "http://deepseek.test",
      apiKey: "key",
      fetch: (async () =>
        new Response(`${"upstream failure ".repeat(100)}`, {
          status: 502,
          statusText: "Bad Gateway",
        })) as unknown as typeof fetch,
    });

    const result = await client.search({ query: "pi" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("502 Bad Gateway");
    expect(result.error).toContain("upstream failure");
    expect(result.error.length).toBeLessThan(700);
  });

  it("extracts search fields and sends the documented request body", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const client = createDeepSeekClient({
      baseUrl: "http://deepseek.test/",
      apiKey: "deepseek-key",
      fetch: (async (url: string, init: RequestInit) => {
        requestedUrl = String(url);
        requestedInit = init;
        return jsonResponse({
          results: [
            {
              title: "Pi Work",
              url: "https://example.com/pi",
              snippet: "snippet text",
              summary: "summary text",
              site_name: "example.com",
              date: "2026-01-02",
              rerank_score: 0.91,
              authority: 0.77,
              content: "page body",
            },
            {
              title: "Second",
              url: "https://example.com/second",
              score: 0.5,
            },
          ],
        });
      }) as unknown as typeof fetch,
    });

    const result = await client.search({ query: "pi work", count: 2, needContent: true });

    expect(requestedUrl).toBe(`http://deepseek.test${DEEPSEEK_SEARCH_PATH}`);
    expect(requestedInit?.method).toBe("POST");
    expect((requestedInit?.headers as Record<string, string>).Authorization).toBe("Bearer deepseek-key");
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      query: "pi work",
      count: 2,
      need_content: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({
      title: "Pi Work",
      url: "https://example.com/pi",
      snippet: "snippet text",
      summary: "summary text",
      siteName: "example.com",
      date: "2026-01-02",
      score: 0.91,
      authority: 0.77,
      content: "page body",
    });
    expect(result.data.results[1].score).toBe(0.5);
    expect(result.data.results[1].summary).toBe("");
  });

  it("rejects a response body above the configured size limit", async () => {
    const client = createDeepSeekClient({
      baseUrl: "http://deepseek.test",
      apiKey: "key",
      maxResponseBytes: 32,
      fetch: (async () =>
        new Response(JSON.stringify({ results: [], padding: "x".repeat(100) }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    const result = await client.search({ query: "pi" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("32-byte limit");
  });

  it("truncates fetch content to the requested length and uses the injected base URL", async () => {
    let requestedUrl = "";
    const client = createDeepSeekClient({
      baseUrl: "http://gateway.test/base",
      apiKey: "key",
      fetch: (async (url: string) => {
        requestedUrl = String(url);
        return jsonResponse({ title: "Long page", content: "abcdefghijklmnopqrstuvwxyz" });
      }) as unknown as typeof fetch,
    });

    const result = await client.fetchPage({ url: "https://example.com/long", maxChars: 10 });

    expect(requestedUrl).toBe(`http://gateway.test/base${DEEPSEEK_FETCH_PATH}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe("Long page");
    expect(result.data.truncated).toBe(true);
    expect(result.data.content.startsWith("abcdefghij")).toBe(true);
    expect(result.data.content).toContain("truncated 16 chars");
  });

  it("maps a timeout to a readable error", async () => {
    const client = createDeepSeekClient({
      baseUrl: "http://deepseek.test",
      apiKey: "key",
      timeoutMs: 1234,
      fetch: (async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }) as unknown as typeof fetch,
    });

    const result = await client.fetchPage({ url: "https://example.com" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("timed out after 1234ms");
  });
});
