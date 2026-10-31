import {
  clampInteger,
  WEB_FETCH_DEFAULT_MAX_CHARS,
  WEB_FETCH_MAX_CHARS,
  WEB_SEARCH_DEFAULT_COUNT,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_MIN_COUNT,
} from "@/lib/shared/web-tools";
import { deepSeekBaseUrl, loadDeepSeekApiKey } from "./credentials";

export const DEEPSEEK_SEARCH_PATH = "/v1/tools/search";

export const DEEPSEEK_FETCH_PATH = "/v1/tools/fetch";

export const DEEPSEEK_REQUEST_TIMEOUT_MS = 30_000;

export const DEEPSEEK_MAX_RESPONSE_BYTES = 2_000_000;

export const DEEPSEEK_ERROR_BODY_MAX_CHARS = 500;

export interface DeepSeekSearchItem {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName: string | null;
  date: string | null;
  score: number | null;
  authority: number | null;
  content: string | null;
}

export interface DeepSeekSearchResult {
  results: DeepSeekSearchItem[];
}

export interface DeepSeekFetchResult {
  title: string;
  content: string;
  truncated: boolean;
}

export type DeepSeekResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DeepSeekClientOptions {
  baseUrl?: string;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface DeepSeekSearchInput {
  query: string;
  count?: number;
  needContent?: boolean;
  signal?: AbortSignal;
}

export interface DeepSeekFetchInput {
  url: string;
  maxChars?: number;
  signal?: AbortSignal;
}

export interface DeepSeekClient {
  search(input: DeepSeekSearchInput): Promise<DeepSeekResult<DeepSeekSearchResult>>;
  fetchPage(input: DeepSeekFetchInput): Promise<DeepSeekResult<DeepSeekFetchResult>>;
}

export const DEEPSEEK_MISSING_KEY_ERROR =
  "DeepSeek API key is not configured. Add it in Settings → DeepSeek API Key or set DEEPSEEK_API_KEY.";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncateWithMarker(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, max)}\n\n… [truncated ${value.length - max} chars]`,
    truncated: true,
  };
}

function errorBodySummary(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > DEEPSEEK_ERROR_BODY_MAX_CHARS
    ? `${compact.slice(0, DEEPSEEK_ERROR_BODY_MAX_CHARS)}…`
    : compact;
}

function mapFetchError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return `DeepSeek API request timed out after ${timeoutMs}ms.`;
    }
    if (error.name === "AbortError") {
      return "DeepSeek API request was aborted.";
    }
    return `DeepSeek API request failed: ${error.message}`;
  }
  return `DeepSeek API request failed: ${String(error)}`;
}

function mapSearchResults(payload: unknown): DeepSeekSearchResult {
  const rawResults = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(rawResults)) return { results: [] };
  const results = rawResults.map((value): DeepSeekSearchItem => {
    const raw = (value ?? {}) as Record<string, unknown>;
    return {
      title: text(raw.title),
      url: text(raw.url),
      snippet: text(raw.snippet),
      summary: text(raw.summary),
      siteName: optionalText(raw.site_name),
      date: optionalText(raw.date),
      score: optionalNumber(raw.rerank_score) ?? optionalNumber(raw.score),
      authority: optionalNumber(raw.authority),
      content: optionalText(raw.content),
    };
  });
  return { results };
}

function mapFetchResult(payload: unknown, maxChars: number): DeepSeekFetchResult {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const content = truncateWithMarker(text(raw.content), maxChars);
  return {
    title: text(raw.title),
    content: content.text,
    truncated: content.truncated,
  };
}

export function createDeepSeekClient(options: DeepSeekClientOptions = {}): DeepSeekClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEEPSEEK_REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEEPSEEK_MAX_RESPONSE_BYTES;
  const baseUrl = (options.baseUrl ?? deepSeekBaseUrl()).replace(/\/+$/, "");

  function apiKey(): string | null {
    return options.apiKey !== undefined ? options.apiKey : loadDeepSeekApiKey();
  }

  async function post(
    path: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<DeepSeekResult<unknown>> {
    const key = apiKey();
    if (!key) return { ok: false, error: DEEPSEEK_MISSING_KEY_ERROR };

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (error) {
      return { ok: false, error: mapFetchError(error, timeoutMs) };
    }

    let rawBody: string;
    try {
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        return {
          ok: false,
          error: `DeepSeek API response exceeded the ${maxResponseBytes}-byte limit.`,
        };
      }
      rawBody = await response.text();
    } catch (error) {
      return { ok: false, error: mapFetchError(error, timeoutMs) };
    }

    if (Buffer.byteLength(rawBody, "utf8") > maxResponseBytes) {
      return {
        ok: false,
        error: `DeepSeek API response exceeded the ${maxResponseBytes}-byte limit.`,
      };
    }

    if (!response.ok) {
      const summary = errorBodySummary(rawBody);
      const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      return {
        ok: false,
        error: `DeepSeek API error (${status})${summary ? `: ${summary}` : ""}`,
      };
    }

    try {
      return { ok: true, data: JSON.parse(rawBody) };
    } catch {
      return { ok: false, error: "DeepSeek API returned a response that is not valid JSON." };
    }
  }

  return {
    async search(input) {
      const count = clampInteger(
        input.count,
        WEB_SEARCH_MIN_COUNT,
        WEB_SEARCH_MAX_COUNT,
        WEB_SEARCH_DEFAULT_COUNT,
      );
      const body: Record<string, unknown> = { query: input.query, count };
      if (input.needContent !== undefined) body.need_content = input.needContent;
      const response = await post(DEEPSEEK_SEARCH_PATH, body, input.signal);
      if (!response.ok) return response;
      return { ok: true, data: mapSearchResults(response.data) };
    },

    async fetchPage(input) {
      const maxChars = clampInteger(
        input.maxChars,
        1,
        WEB_FETCH_MAX_CHARS,
        WEB_FETCH_DEFAULT_MAX_CHARS,
      );
      const response = await post(DEEPSEEK_FETCH_PATH, { url: input.url }, input.signal);
      if (!response.ok) return response;
      return { ok: true, data: mapFetchResult(response.data, maxChars) };
    },
  };
}
