import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { readConfig } from "../config";
import { fetchContent } from "./fetch-content";

const SearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Web search query." }),
  numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Number of results, default 5." })),
  recencyFilter: Type.Optional(Type.Union([
    Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year"),
  ])),
  domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Domains to include; prefix with '-' to exclude." })),
  includeContent: Type.Optional(Type.Boolean({ description: "Include Tavily's raw Markdown content when available." })),
});

const FetchParams = Type.Object({
  url: Type.String({ minLength: 1, description: "HTTP or HTTPS URL to fetch." }),
  mode: Type.Optional(Type.Union([Type.Literal("readable"), Type.Literal("raw")])),
});

function textResult<T>(text: string, details: T) {
  return { content: [{ type: "text" as const, text }], details };
}

function requireTavilyKey(): string {
  const key = process.env.TAVILY_API_KEY?.trim() || readConfig().web_access.tavily.api_key?.trim();
  if (!key) throw new Error("Tavily API Key is not configured. Open Settings → Web Access and add it.");
  return key;
}

function domains(filters: string[] | undefined): { include_domains?: string[]; exclude_domains?: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of filters ?? []) {
    const value = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!value) continue;
    const target = raw.trim().startsWith("-") ? exclude : include;
    const domain = value.replace(/^-/, "");
    if (domain && !target.includes(domain)) target.push(domain);
  }
  return { ...(include.length ? { include_domains: include } : {}), ...(exclude.length ? { exclude_domains: exclude } : {}) };
}

export const webSearchTool = defineTool<typeof SearchParams, Record<string, unknown>>({
  name: "web_search",
  label: "Web Search",
  description: "Search the web using Tavily and return a synthesized answer with source citations.",
  parameters: SearchParams,
  executionMode: "sequential",
  promptSnippet: "Search the web when current or external information is needed.",
  promptGuidelines: ["Use web_search for current facts, documentation, news, or information outside the workspace."],
  async execute(_toolCallId, params, signal) {
    const apiKey = requireTavilyKey();
    const count = Math.max(1, Math.min(20, Math.floor(params.numResults ?? 5)));
    const body = {
      query: params.query,
      search_depth: "basic",
      max_results: count,
      include_answer: "basic",
      include_raw_content: params.includeContent === true ? "markdown" : false,
      ...(params.recencyFilter ? { time_range: params.recencyFilter } : {}),
      ...domains(params.domainFilter),
    };
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const upstream = (await response.text()).slice(0, 300).replaceAll(apiKey, "[REDACTED]");
      throw new Error(`Tavily API error ${response.status}: ${upstream}`);
    }
    const data = await response.json() as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string | null }> };
    const results = (data.results ?? []).filter((item) => typeof item.url === "string").slice(0, count).map((item) => ({ title: item.title || "Untitled", url: item.url!, snippet: item.content || "" }));
    const inlineContent = params.includeContent ? (data.results ?? []).filter((item) => item.url && item.raw_content).map((item) => ({ url: item.url!, title: item.title || "", content: item.raw_content! })) : [];
    const details = { answer: data.answer || "", results, ...(inlineContent.length ? { inlineContent } : {}) };
    return textResult(JSON.stringify(details, null, 2), details);
  },
});

export const fetchContentTool = defineTool<typeof FetchParams, Awaited<ReturnType<typeof fetchContent>>>({
  name: "fetch_content",
  label: "Fetch Content",
  description: "Fetch a public HTTP(S) URL and return readable Markdown or raw text.",
  parameters: FetchParams,
  executionMode: "sequential",
  promptSnippet: "Fetch a web page when you need its full content.",
  promptGuidelines: ["Use fetch_content after web_search when source details are needed; use raw mode for APIs or exact text."],
  async execute(_toolCallId, params, signal) {
    try {
      const result = await fetchContent(params.url, params.mode ?? "readable", signal);
      return textResult(result.content, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResult(`fetch_content failed: ${message}`, { url: params.url, title: "", content: "", contentType: "", status: 0 });
    }
  },
});

export function buildWebAccessTools() {
  return [webSearchTool, fetchContentTool];
}
