/**
 * LLM API call audit capture layer.
 *
 * Design: a single process-level `globalThis.fetch` patch is the one true
 * recording point — it sees the actual HTTP request (URL + raw JSON body)
 * and the actual response (status, headers, and for non-2xx the full error
 * body). A thin ModelRuntime wrapper only stamps authoritative model metadata
 * (provider/modelId/api) into an AsyncLocalStorage context, and the
 * rpc-manager's `send()` wraps each command in that context so every fetch
 * can be attributed to a session.
 *
 * 2xx response bodies are deliberately NOT captured (they are SSE streams
 * consumed by the SDK); only non-2xx bodies are read (via `response.clone()`)
 * so the SDK still sees the original response and builds its APIError as
 * before. Success-path overhead is one timestamp + one insert.
 *
 * Server-only file: imports `@earendil-works/pi-ai` types and
 * `better-sqlite3` transitively. Client code must import types from
 * `lib/llm-audit-types.ts` instead.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger";
import { insertProviderCall } from "./llm-audit-db";
import type { LlmAuditSource } from "../shared/llm-audit-types";

const log = createLogger("llm-audit");

/** Per-command audit context carried through the whole prompt/stream chain. */
export interface LlmAuditContext {
  sessionId: string | null;
  source: LlmAuditSource | null;
  /** Session cwd at command time. */
  cwd: string | null;
  /** Session display name at command time, if any. */
  sessionName: string | null;
  /** Authoritative model metadata stamped by the ModelRuntime wrapper. */
  model: { provider: string; modelId: string; api: string | null } | null;
  /** Retry ordinal, incremented by the wrapper on each provider attempt. */
  attempt: number;
}

// ── Cross-module state ────────────────────────────────────────────────────
// All of this lives on `globalThis` (not module scope) because Next.js dev
// HMR re-evaluates this module while the already-installed fetch patch keeps
// running. A module-scoped Set/ALS would silently desync: the new module
// writes hostnames/context into ITS instances while the old patch reads the
// OLD ones → no hostname match (nothing recorded) and no session attribution
// (every call logged as unknown). globalThis keeps a single shared instance
// across every HMR incarnation.

declare global {
  var __piLlmAuditHosts: Set<string> | undefined;
  var __piLlmAuditAls: AsyncLocalStorage<LlmAuditContext> | undefined;
  var __piLlmFetchOrig: typeof fetch | undefined;
}

function getHosts(): Set<string> {
  if (!globalThis.__piLlmAuditHosts) globalThis.__piLlmAuditHosts = new Set();
  return globalThis.__piLlmAuditHosts;
}

function getAls(): AsyncLocalStorage<LlmAuditContext> {
  if (!globalThis.__piLlmAuditAls) globalThis.__piLlmAuditAls = new AsyncLocalStorage<LlmAuditContext>();
  return globalThis.__piLlmAuditAls;
}

/**
 * Shared AsyncLocalStorage. Access it via `getLlmAuditAls()` so HMR never
 * splits writers and readers across two ALS instances.
 */
export function getLlmAuditAls(): AsyncLocalStorage<LlmAuditContext> {
  return getAls();
}

/** Run a function (typically `wrapper.send(...)`) inside an audit context. */
export function runWithLlmAuditContext<T>(ctx: Omit<LlmAuditContext, "model" | "attempt">, fn: () => Promise<T>): Promise<T> {
  return getAls().run({ ...ctx, model: null, attempt: 0 }, fn);
}

// ── Provider host allowlist ────────────────────────────────────────────────

function addHost(baseUrl: string): void {
  try {
    getHosts().add(new URL(baseUrl).hostname);
  } catch {
    // unparseable baseUrl — skip
  }
}

/**
 * Collect LLM provider hostnames from every registered provider and model so
 * the fetch patch only touches actual LLM traffic and never interferes with
 * the app's own fetches.
 */
export function collectProviderHosts(runtime: ModelRuntime): void {
  try {
    const hosts = getHosts();
    for (const p of runtime.getProviders()) {
      if (p.baseUrl) addHost(p.baseUrl);
      for (const m of p.getModels()) {
        if (m.baseUrl) addHost(m.baseUrl);
      }
    }
    log.debug("provider hosts collected", { hosts: [...hosts] });
  } catch (e) {
    log.warn("provider host collection failed", { error: String(e) });
  }
}

function isProviderHost(hostname: string): boolean {
  return getHosts().has(hostname);
}

// ── Header handling ────────────────────────────────────────────────────────

function headersToRecord(headers: Headers): Record<string, string> {
  const rec: Record<string, string> = {};
  headers.forEach((v, k) => {
    rec[k] = v;
  });
  return rec;
}

function maskSecret(value: string): string {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

/** Serialize request headers as JSON with sensitive values masked. */
function safeRequestHeaders(headersInit: HeadersInit | undefined): string | null {
  if (!headersInit) return null;
  const rec: Record<string, string> = {};
  try {
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => {
        rec[k] = v;
      });
    } else if (Array.isArray(headersInit)) {
      for (const [k, v] of headersInit) rec[k] = v;
    } else {
      Object.assign(rec, headersInit);
    }
  } catch {
    return null;
  }
  for (const key of Object.keys(rec)) {
    if (/^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(key)) {
      rec[key] = maskSecret(rec[key]);
    }
  }
  return JSON.stringify(rec);
}

// ── Fallback inference (only used when the audit context has no model) ────

const KNOWN_PROVIDER_HOSTS: Record<string, string> = {
  "api.anthropic.com": "anthropic",
  "api.openai.com": "openai",
  "api.deepseek.com": "deepseek",
  "api.x.ai": "xai",
  "api.groq.com": "groq",
  "openrouter.ai": "openrouter",
  "generativelanguage.googleapis.com": "google",
  "api.minimaxi.com": "minimax-cn",
  "api.mistral.ai": "mistral",
  "api.moonshot.cn": "moonshotai-cn",
  "api.moonshot.ai": "moonshotai",
  "open.bigmodel.cn": "zai",
  "api.kimi.com": "kimi-coding",
  "api.z.ai": "zai",
  "api.together.ai": "together",
  "api.fireworks.ai": "fireworks",
};

function inferProviderFromUrl(url: URL): string | null {
  return KNOWN_PROVIDER_HOSTS[url.hostname] ?? url.hostname;
}

function inferApiFromUrl(url: URL): string | null {
  const p = url.pathname;
  if (p.includes("/v1/messages")) return "anthropic-messages";
  if (p.includes("/chat/completions")) return "openai-completions";
  if (p.includes("/responses")) return "openai-responses";
  if (p.includes("generativelanguage")) return "google-generative-ai";
  return null;
}

function inferModelIdFromBody(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === "string" ? parsed.model : null;
  } catch {
    return null;
  }
}

// ── Response body read (non-2xx only, bounded) ────────────────────────────

const MAX_ERROR_BODY_BYTES = 512 * 1024;

async function readBodyBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          break;
        }
      }
    }
  } catch {
    // stream aborted/errored — return what we have
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

// ── ModelRuntime wrapper ───────────────────────────────────────────────────

declare global {
  var __piLlmAuditModelRuntime: ModelRuntime | undefined;
}

/**
 * Wrap a ModelRuntime so every stream call stamps authoritative model
 * metadata (and bumps the retry counter) into the current audit context.
 * All other methods pass through untouched via Proxy.
 */
export function wrapModelRuntime(runtime: ModelRuntime): ModelRuntime {
  collectProviderHosts(runtime);
  const wrapped = new Proxy(runtime, {
    get(target, prop, receiver) {
      if (prop === "streamSimple" || prop === "stream" || prop === "completeSimple" || prop === "complete") {
        const fn = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown;
        return (...args: unknown[]): unknown => {
          const model = args[0] as { provider?: string; id?: string; api?: string } | undefined;
          if (model?.provider && model.id) {
            const store = getLlmAuditAls().getStore();
            if (store) {
              store.model = { provider: model.provider, modelId: model.id, api: model.api ?? null };
              store.attempt += 1;
            }
          }
          return fn.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return wrapped as unknown as ModelRuntime;
}

/** Get (and lazily create) the process-wide shared wrapped ModelRuntime. */
export function getAuditModelRuntime(runtime: ModelRuntime): ModelRuntime {
  if (!globalThis.__piLlmAuditModelRuntime) {
    globalThis.__piLlmAuditModelRuntime = wrapModelRuntime(runtime);
  }
  return globalThis.__piLlmAuditModelRuntime;
}

/** Reload models.json in the shared runtime after an in-process config write. */
export async function refreshAuditModelRuntime(): Promise<boolean> {
  const runtime = globalThis.__piLlmAuditModelRuntime;
  if (!runtime) return false;
  await runtime.refresh({ allowNetwork: false });
  collectProviderHosts(runtime);
  return true;
}

// ── fetch patch ────────────────────────────────────────────────────────────

/**
 * Install the process-level fetch patch.
 *
 * NOT idempotent-guarded with a module-scoped flag: on HMR the module
 * re-evaluates and must REPLACE the previously installed patch (whose closure
 * references the OLD module's functions), otherwise the old closure's
 * stale references keep running. We always re-install against the pristine
 * native fetch saved on `globalThis`, so the wrapper stack stays one layer
 * deep no matter how many times the module reloads.
 */
export function installLlmFetchAudit(): void {
  if (!globalThis.__piLlmFetchOrig) {
    globalThis.__piLlmFetchOrig = globalThis.fetch;
  }
  const originalFetch = globalThis.__piLlmFetchOrig;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = async function llmAuditFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: URL | null = null;
    try {
      url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    } catch {
      return originalFetch.call(this, input, init);
    }
    if (!url || !isProviderHost(url.hostname)) {
      return originalFetch.call(this, input, init);
    }

    const store = getLlmAuditAls().getStore();
    const ts = Date.now();
    const requestBody = typeof init?.body === "string" ? init.body : null;
    const requestHeaders = safeRequestHeaders(init?.headers);
    const sessionId = store?.sessionId ?? null;
    const source = store?.source ?? null;
    const attempt = store?.attempt ?? 1;
    const cwd = store?.cwd ?? null;
    const sessionName = store?.sessionName ?? null;
    const provider = store?.model?.provider ?? inferProviderFromUrl(url);
    const modelId = store?.model?.modelId ?? inferModelIdFromBody(requestBody);
    const api = store?.model?.api ?? inferApiFromUrl(url);
    const urlString = url.toString();

    try {
      const response = await originalFetch.call(this, input, init);
      const status = response.status;
      const responseHeaders = JSON.stringify(headersToRecord(response.headers));
      const durationMs = Date.now() - ts;
      let responseBody: string | null = null;
      if (!response.ok) {
        try {
          responseBody = await readBodyBounded(response.clone(), MAX_ERROR_BODY_BYTES);
        } catch {
          // body read failed — keep null, never break the original flow
        }
      }
      try {
        insertProviderCall({
          ts,
          sessionId,
          source: source ?? "unknown",
          cwd,
          sessionName,
          provider,
          modelId,
          api,
          url: urlString,
          attempt,
          requestBody,
          requestHeaders,
          status,
          responseHeaders,
          responseBody,
          error: null,
          durationMs,
        });
      } catch (e) {
        log.warn("llm-audit insert failed", { error: String(e) });
      }
      return response;
    } catch (error) {
      try {
        insertProviderCall({
          ts,
          sessionId,
          source: source ?? "unknown",
          cwd,
          sessionName,
          provider,
          modelId,
          api,
          url: urlString,
          attempt,
          requestBody,
          requestHeaders,
          status: null,
          responseHeaders: null,
          responseBody: null,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - ts,
        });
      } catch (e) {
        log.warn("llm-audit insert failed", { error: String(e) });
      }
      throw error;
    }
  };
}

// Install eagerly at module load. On HMR the module re-evaluates and this
// re-installs the patch with the LATEST closure (fresh globalThis-backed
// hosts/ALS), replacing any stale wrapper left behind by the previous
// incarnation. Without this, a reloaded module's new code never takes effect
// until the next startRpcSession call.
installLlmFetchAudit();
