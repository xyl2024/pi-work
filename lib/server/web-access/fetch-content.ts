import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchRemoteText } from "./ssrf";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_USEFUL_CONTENT = 200;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface FetchContentResult {
  url: string;
  title: string;
  content: string;
  contentType: string;
  status: number;
}

function titleFromText(text: string, url: string): string {
  const heading = text.match(/^#{1,2}\s+(.+)/m)?.[1]?.trim();
  return heading || new URL(url).pathname.split("/").filter(Boolean).pop() || url;
}

export async function fetchContent(rawUrl: string, mode: "readable" | "raw" = "readable", signal?: AbortSignal): Promise<FetchContentResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const { url, response, text } = await fetchRemoteText(rawUrl, controller.signal);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (mode === "raw") {
      if (!contentType.startsWith("text/") && !contentType.includes("json") && !contentType.includes("xml")) {
        throw new Error(`Unsupported content type in raw mode: ${contentType || "missing"}`);
      }
      return { url, title: titleFromText(text, url), content: text, contentType, status: response.status };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    if (!contentType.startsWith("text/html") && contentType !== "application/xhtml+xml") {
      return { url, title: titleFromText(text, url), content: text, contentType, status: response.status };
    }
    const { document } = parseHTML(text);
    const article = new Readability(document as unknown as Document).parse();
    if (!article?.content) throw new Error("Could not extract readable content from HTML structure");
    const markdown = turndown.turndown(article.content);
    if (markdown.trim().length < MIN_USEFUL_CONTENT) throw new Error("Extracted content appears incomplete");
    return { url, title: article.title?.trim() || document.title?.trim() || url, content: markdown, contentType, status: response.status };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
