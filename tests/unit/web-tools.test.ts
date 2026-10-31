import { describe, expect, it, vi } from "vitest";
import {
  createWebFetchTool,
  createWebSearchTool,
  subagentWebTools,
} from "@/lib/server/web-tools";
import {
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/shared/web-tools";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeOptions(fetchMock: (url: string, init: RequestInit) => Promise<Response>) {
  return {
    baseUrl: "http://deepseek.test",
    apiKey: "test-key",
    fetch: fetchMock as unknown as typeof fetch,
  };
}

type ToolResultLike = {
  content: Array<{ type: string; text?: string }>;
  details: {
    ok: boolean;
    resultCount?: number;
    requestedMaxChars?: number;
    truncated?: boolean;
  };
};

type WebTool = ReturnType<typeof createWebSearchTool> | ReturnType<typeof createWebFetchTool>;

async function run(tool: WebTool, params: Record<string, unknown>): Promise<ToolResultLike> {
  return (await tool.execute(
    "call-1",
    params as never,
    undefined,
    undefined,
    undefined as never,
  )) as ToolResultLike;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("web tools", () => {
  it("formats search results with titles, URLs, summaries and confidence fields", async () => {
    const tool = createWebSearchTool(
      fakeOptions(async () =>
        jsonResponse({
          results: [
            {
              title: "Pi Work",
              url: "https://example.com/pi",
              summary: "A web UI for pi.",
              rerank_score: 0.93,
              authority: 0.81,
            },
          ],
        }),
      ),
    );

    const result = await run(tool, { query: "pi work" });

    const text = textOf(result);
    expect(text).toContain("Found 1 result");
    expect(text).toContain("Pi Work");
    expect(text).toContain("https://example.com/pi");
    expect(text).toContain("A web UI for pi.");
    expect(text).toContain("score=0.93");
    expect(text).toContain("authority=0.81");
    expect(result.details.ok).toBe(true);
    expect(result.details.resultCount).toBe(1);
  });

  it("returns a readable message when the search finds nothing", async () => {
    const tool = createWebSearchTool(fakeOptions(async () => jsonResponse({ results: [] })));

    const result = await run(tool, { query: "nothing here" });

    expect(textOf(result)).toBe('No results for "nothing here".');
    expect(result.details.resultCount).toBe(0);
  });

  it("returns tool errors as content instead of throwing", async () => {
    const tool = createWebSearchTool(fakeOptions(async () => new Response("nope", { status: 500 })));

    const result = await run(tool, { query: "pi" });

    expect(textOf(result)).toContain("Error: DeepSeek API error (500");
    expect(result.details.ok).toBe(false);
  });

  it("returns a readable error when the API key is missing", async () => {
    const tool = createWebSearchTool({
      baseUrl: "http://deepseek.test",
      apiKey: null,
      fetch: vi.fn() as unknown as typeof fetch,
    });

    const result = await run(tool, { query: "pi" });

    expect(textOf(result)).toContain("Error: DeepSeek API key is not configured");
    expect(result.details.ok).toBe(false);
  });

  it("clamps max_chars to the documented cap and marks truncated fetch output", async () => {
    let requestedBody = "";
    const tool = createWebFetchTool(
      fakeOptions(async (_url, init) => {
        requestedBody = String(init.body);
        return jsonResponse({ title: "Big page", content: "x".repeat(WEB_FETCH_MAX_CHARS + 100) });
      }),
    );

    const result = await run(tool, { url: "https://example.com/big", max_chars: 9_000_000 });

    expect(requestedBody).toBe(JSON.stringify({ url: "https://example.com/big" }));
    expect(result.details.requestedMaxChars).toBe(WEB_FETCH_MAX_CHARS);
    expect(result.details.truncated).toBe(true);
    expect(textOf(result).startsWith("# Big page\n\n")).toBe(true);
    expect(textOf(result)).toContain("truncated 100 chars");
  });

  it("uses the default max_chars when none is requested", async () => {
    const tool = createWebFetchTool(
      fakeOptions(async () => jsonResponse({ title: "Page", content: "short" })),
    );

    const result = await run(tool, { url: "https://example.com" });

    expect(result.details.requestedMaxChars).toBe(8000);
    expect(result.details.truncated).toBe(false);
    expect(textOf(result)).toBe("# Page\n\nshort");
  });

  it("registers the web tools only for the subagent source", () => {
    const names = (source: "user" | "scheduled" | "subagent") =>
      subagentWebTools(source).map((tool) => tool.name);

    expect(names("user")).toEqual([]);
    expect(names("scheduled")).toEqual([]);
    expect(names("subagent")).toEqual([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]);
  });
});
