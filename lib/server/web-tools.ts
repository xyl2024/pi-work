import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  WEB_FETCH_DEFAULT_MAX_CHARS,
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_DEFAULT_COUNT,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_MIN_COUNT,
  WEB_SEARCH_TOOL_NAME,
  type WebFetchToolDetails,
  type WebSearchToolDetails,
} from "@/lib/shared/web-tools";
import {
  createDeepSeekClient,
  DEEPSEEK_MISSING_KEY_ERROR,
  type DeepSeekClientOptions,
  type DeepSeekSearchItem,
} from "./deepseek/client";

export {
  WEB_FETCH_SYSTEM_PROMPT_BLOCK,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_SYSTEM_PROMPT_BLOCK,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/shared/web-tools";

export type WebToolSource = "user" | "scheduled" | "subagent";

const WebSearchParams = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description: "Search query.",
    }),
    count: Type.Optional(
      Type.Integer({
        minimum: WEB_SEARCH_MIN_COUNT,
        maximum: WEB_SEARCH_MAX_COUNT,
        default: WEB_SEARCH_DEFAULT_COUNT,
        description: `Number of results to return (${WEB_SEARCH_MIN_COUNT}-${WEB_SEARCH_MAX_COUNT}). Default ${WEB_SEARCH_DEFAULT_COUNT}.`,
      }),
    ),
    include_content: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Also return the extracted page content for each result. Default false.",
      }),
    ),
  },
  { additionalProperties: false },
);

const WebFetchParams = Type.Object(
  {
    url: Type.String({
      minLength: 1,
      description: "Absolute URL of the page to fetch.",
    }),
    max_chars: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: WEB_FETCH_MAX_CHARS,
        default: WEB_FETCH_DEFAULT_MAX_CHARS,
        description: `Maximum number of content characters to return (1-${WEB_FETCH_MAX_CHARS}). Default ${WEB_FETCH_DEFAULT_MAX_CHARS}.`,
      }),
    ),
  },
  { additionalProperties: false },
);

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(Math.max(numeric, min), max);
}

function confidenceLine(item: DeepSeekSearchItem): string {
  const parts: string[] = [];
  if (item.score !== null) parts.push(`score=${item.score}`);
  if (item.authority !== null) parts.push(`authority=${item.authority}`);
  return parts.length > 0 ? parts.join(", ") : "not provided by the search API";
}

function searchText(query: string, results: DeepSeekSearchItem[], includeContent: boolean): string {
  if (results.length === 0) return `No results for "${query}".`;
  const lines: string[] = [`Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}".`];
  results.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.title || "(untitled)"}`);
    if (item.url) lines.push(`   URL: ${item.url}`);
    if (item.summary) lines.push(`   Summary: ${item.summary}`);
    if (item.snippet && item.snippet !== item.summary) lines.push(`   Snippet: ${item.snippet}`);
    lines.push(`   Confidence: ${confidenceLine(item)}`);
    const meta = [item.siteName, item.date].filter((value): value is string => Boolean(value));
    if (meta.length > 0) lines.push(`   Site: ${meta.join(" · ")}`);
    if (includeContent && item.content) lines.push(`   Content: ${item.content}`);
  });
  return lines.join("\n");
}

function searchErrorText(message: string): string {
  return `Error: ${message}`;
}

export function createWebSearchTool(options: DeepSeekClientOptions = {}) {
  return defineTool<typeof WebSearchParams, WebSearchToolDetails>({
    name: WEB_SEARCH_TOOL_NAME,
    label: "Web search",
    description:
      "Search the web through the DeepSeek Search API. Returns titles, URLs, snippets or summaries, and confidence fields (score, authority) for each result. Use web_fetch to read a page in full.",
    parameters: WebSearchParams,
    executionMode: "sequential",
    promptSnippet: "Search the web and return titled, sourced results with confidence fields.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute(_toolCallId, params, signal) {
      const query = params.query.trim();
      const count = clampInteger(params.count, WEB_SEARCH_MIN_COUNT, WEB_SEARCH_MAX_COUNT, WEB_SEARCH_DEFAULT_COUNT);
      const includeContent = params.include_content === true;
      if (!query) {
        return {
          content: [{ type: "text" as const, text: searchErrorText("query must not be empty.") }],
          details: { query, count, includeContent, resultCount: 0, ok: false },
        };
      }
      const client = createDeepSeekClient(options);
      const result = await client.search({ query, count, needContent: includeContent, signal });
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: searchErrorText(result.error) }],
          details: { query, count, includeContent, resultCount: 0, ok: false },
        };
      }
      const results = result.data.results;
      return {
        content: [{ type: "text" as const, text: searchText(query, results, includeContent) }],
        details: { query, count, includeContent, resultCount: results.length, ok: true },
      };
    },
  });
}

export function createWebFetchTool(options: DeepSeekClientOptions = {}) {
  return defineTool<typeof WebFetchParams, WebFetchToolDetails>({
    name: WEB_FETCH_TOOL_NAME,
    label: "Web fetch",
    description:
      "Fetch a web page through the DeepSeek Fetch API and return its title plus Markdown content. Use max_chars to cap how much content enters the context.",
    parameters: WebFetchParams,
    executionMode: "sequential",
    promptSnippet: "Fetch a web page as a title and Markdown content, with a length cap.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute(_toolCallId, params, signal) {
      const url = params.url.trim();
      const maxChars = clampInteger(params.max_chars, 1, WEB_FETCH_MAX_CHARS, WEB_FETCH_DEFAULT_MAX_CHARS);
      if (!url) {
        return {
          content: [{ type: "text" as const, text: searchErrorText("url must not be empty.") }],
          details: { url, requestedMaxChars: maxChars, title: null, contentChars: 0, truncated: false, ok: false },
        };
      }
      const client = createDeepSeekClient(options);
      const result = await client.fetchPage({ url, maxChars, signal });
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: searchErrorText(result.error) }],
          details: { url, requestedMaxChars: maxChars, title: null, contentChars: 0, truncated: false, ok: false },
        };
      }
      const title = result.data.title || url;
      return {
        content: [{ type: "text" as const, text: `# ${title}\n\n${result.data.content}` }],
        details: {
          url,
          requestedMaxChars: maxChars,
          title: result.data.title || null,
          contentChars: result.data.content.length,
          truncated: result.data.truncated,
          ok: true,
        },
      };
    },
  });
}

export const webSearchTool = createWebSearchTool();

export const webFetchTool = createWebFetchTool();

const SUBAGENT_WEB_TOOLS = [webSearchTool, webFetchTool];

export function subagentWebTools(source: WebToolSource) {
  return source === "subagent" ? SUBAGENT_WEB_TOOLS : [];
}

export { DEEPSEEK_MISSING_KEY_ERROR };
